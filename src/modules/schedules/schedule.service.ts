import { env } from "../../config/env.js";
import { databasePool, withTransaction } from "../../core/database/pool.js";
import { logger } from "../../core/logger/logger.js";
import {
  claimScheduleReminderDelivery,
  createManualReminderBatch,
  findActiveScheduleByName,
  insertActivitySchedule,
  listActiveSchedules,
  markScheduleReminderDelivery,
} from "./schedule.repository.js";
import type {
  ActivitySchedule,
  CreateActivityScheduleInput,
  ReminderDispatchSummary,
  ScheduleOccurrence,
} from "./schedule.types.js";

export type ScheduleMessageSender = {
  sendMessage: (phoneNumber: string, text: string) => Promise<void>;
  sendGroupMessage: (
    groupJid: string,
    text: string,
    mentions: string[],
  ) => Promise<void>;
};

function parseDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Tanggal harus memakai format YYYY-MM-DD.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Tanggal tidak valid.");
  }
}

function parseTime(value: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("Jam harus memakai format HH:MM.");
  }
}

function normalizeGroupJid(value: string | null | undefined): string | null {
  if (!value || value.trim() === "-") return null;
  const normalized = value.trim();
  if (!/^[0-9]+(?:-[0-9]+)?@g\.us$/i.test(normalized)) {
    throw new Error("ID grup WhatsApp tidak valid. Gunakan ID dari command Idgrup.");
  }
  return normalized;
}

export function validateCreateActivityScheduleInput(input: CreateActivityScheduleInput): void {
  if (!input.name.trim() || input.name.trim().length > 150) {
    throw new Error("Nama kegiatan wajib diisi dan maksimal 150 karakter.");
  }
  parseDate(input.startDate);
  parseTime(input.startTime);
  const interval = input.intervalValue ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366) {
    throw new Error("Interval jadwal harus berupa angka 1 sampai 366.");
  }
  const weekdayValid = (input.weeklyDays ?? []).every(
    (day) => Number.isSafeInteger(day) && day >= 1 && day <= 7,
  );
  const monthlyDayValid = (input.monthlyDays ?? []).every(
    (day) => Number.isSafeInteger(day) && day >= 1 && day <= 31,
  );
  if (!weekdayValid || new Set(input.weeklyDays).size !== (input.weeklyDays ?? []).length) {
    throw new Error("Hari mingguan tidak valid.");
  }
  if (!monthlyDayValid || new Set(input.monthlyDays).size !== (input.monthlyDays ?? []).length) {
    throw new Error("Tanggal bulanan tidak valid.");
  }
  if (input.type === "WEEKLY" && (input.weeklyDays?.length ?? 0) === 0) {
    throw new Error("Jadwal mingguan harus memiliki minimal satu hari.");
  }
  if (input.type === "MONTHLY" && (input.monthlyDays?.length ?? 0) === 0) {
    throw new Error("Jadwal bulanan harus memiliki minimal satu tanggal.");
  }
  if (input.type === "CUSTOM") {
    if (!input.customMode) throw new Error("Mode jadwal custom belum dipilih.");
    if (input.customMode === "INTERVAL" && !input.customUnit) {
      throw new Error("Unit interval custom belum dipilih.");
    }
    if (input.customMode === "DATES") {
      if (!input.customDates?.length) {
        throw new Error("Jadwal custom tanggal khusus harus memiliki minimal satu tanggal.");
      }
      for (const occurrence of input.customDates) {
        parseDate(occurrence.date);
        parseTime(occurrence.time);
      }
    }
  }
  if (input.members.length === 0) {
    throw new Error("Pilih minimal satu petugas aktif.");
  }
  for (const member of input.members) {
    if (member.weekday != null && (!Number.isSafeInteger(member.weekday) || member.weekday < 1 || member.weekday > 7)) {
      throw new Error("Pola hari petugas tidak valid.");
    }
  }
  const offsets = input.reminderOffsetsMinutes ?? [-30, 0];
  if (offsets.length === 0 || offsets.length > 10 || offsets.some((offset) => !Number.isSafeInteger(offset) || offset < -10_080 || offset > 10_080)) {
    throw new Error("Offset reminder harus berupa menit antara -10080 dan 10080.");
  }
  if (new Set(offsets).size !== offsets.length) {
    throw new Error("Offset reminder tidak boleh duplikat.");
  }
  normalizeGroupJid(input.groupJid);
}

export async function createActivitySchedule(
  input: CreateActivityScheduleInput,
): Promise<ActivitySchedule> {
  validateCreateActivityScheduleInput(input);
  return withTransaction((client) =>
    insertActivitySchedule(client, {
      ...input,
      name: input.name.trim(),
      groupJid: normalizeGroupJid(input.groupJid),
      reminderOffsetsMinutes: [...(input.reminderOffsetsMinutes ?? [-30, 0])].sort((a, b) => a - b),
      weeklyDays: [...(input.weeklyDays ?? [])].sort((a, b) => a - b),
      monthlyDays: [...(input.monthlyDays ?? [])].sort((a, b) => a - b),
    }),
  );
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

function isoWeekday(value: string): number {
  const day = utcDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

function monthDistance(from: string, to: string): number {
  const start = utcDate(from);
  const end = utcDate(to);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

function isRegularOccurrenceOnDate(schedule: ActivitySchedule, date: string): boolean {
  const dayDistance = daysBetween(schedule.startDate, date);
  if (dayDistance < 0) return false;
  if (schedule.type === "DAILY") return dayDistance % schedule.intervalValue === 0;
  if (schedule.type === "WEEKLY") {
    if (!schedule.weeklyDays.includes(isoWeekday(date))) return false;
    const startMonday = addDays(schedule.startDate, 1 - isoWeekday(schedule.startDate));
    return daysBetween(startMonday, date) % (schedule.intervalValue * 7) < 7;
  }
  if (schedule.type === "MONTHLY") {
    const distance = monthDistance(schedule.startDate, date);
    return distance >= 0 && distance % schedule.intervalValue === 0 && schedule.monthlyDays.includes(utcDate(date).getUTCDate());
  }
  if (schedule.customMode !== "INTERVAL") return false;
  if (schedule.customUnit === "DAYS") return dayDistance % schedule.intervalValue === 0;
  if (schedule.customUnit === "WEEKS") return dayDistance % (schedule.intervalValue * 7) === 0;
  return utcDate(date).getUTCDate() === utcDate(schedule.startDate).getUTCDate()
    && monthDistance(schedule.startDate, date) >= 0
    && monthDistance(schedule.startDate, date) % schedule.intervalValue === 0;
}

export function getScheduleOccurrencesOnDate(
  schedule: ActivitySchedule,
  date: string,
): ScheduleOccurrence[] {
  const weekday = isoWeekday(date);
  const selectedMembers = schedule.members.filter((member) => member.weekday === weekday);
  const members = selectedMembers.length > 0
    ? selectedMembers
    : schedule.members.filter((member) => member.weekday === null);
  if (schedule.type === "CUSTOM" && schedule.customMode === "DATES") {
    return schedule.customDates
      .filter((entry) => entry.date === date)
      .map((entry) => ({ schedule, date, time: entry.time, members }));
  }
  return isRegularOccurrenceOnDate(schedule, date)
    ? [{ schedule, date, time: schedule.startTime, members }]
    : [];
}

function localNow(date = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: env.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function toWallClockMilliseconds(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(year!, month! - 1, day!, hour!, minute!);
}

function formatOccurrenceDate(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(utcDate(date));
}

export function buildScheduleReminderMessage(occurrence: ScheduleOccurrence): string {
  const mentions = occurrence.members.map((member) => `@${member.phoneNumber}`);
  return [
    "*PENGINGAT JADWAL*",
    `Kegiatan: *${occurrence.schedule.name}*`,
    `Pelaksanaan: ${formatOccurrenceDate(occurrence.date)} • ${occurrence.time} WIB`,
    "",
    "Petugas:",
    ...(mentions.length > 0 ? mentions : ["Belum ada petugas aktif."]),
    "",
    "Mohon bersiap dan melaksanakan tugas sesuai jadwal.",
  ].join("\n");
}

function buildDirectScheduleReminderMessage(
  occurrence: ScheduleOccurrence,
  username: string,
): string {
  return [
    `Assalamu'alaikum ${username},`,
    "",
    `Pengingat tugas *${occurrence.schedule.name}*.`,
    `Pelaksanaan: ${formatOccurrenceDate(occurrence.date)} pukul ${occurrence.time} WIB.`,
    "Mohon bersiap dan melaksanakan tugas sesuai jadwal.",
  ].join("\n");
}

function errorReason(error: unknown): string {
  return (error instanceof Error ? error.message : "Pengiriman gagal.").slice(0, 2_000);
}

async function dispatchOccurrence(
  occurrence: ScheduleOccurrence,
  source: "AUTOMATIC" | "MANUAL",
  sender: ScheduleMessageSender,
  input: { batchId?: string; offsetMinutes?: number },
): Promise<{ recipientCount: number; sentCount: number; failedCount: number }> {
  if (occurrence.members.length === 0) {
    throw new Error(`Jadwal ${occurrence.schedule.name} belum memiliki petugas aktif.`);
  }
  const message = buildScheduleReminderMessage(occurrence);
  const prefix = source === "AUTOMATIC"
    ? `auto:${occurrence.schedule.id}:${occurrence.date}:${occurrence.time}:${input.offsetMinutes}`
    : `manual:${input.batchId}`;
  const targets = occurrence.schedule.groupJid
    ? [{ type: "GROUP" as const, groupJid: occurrence.schedule.groupJid }]
    : occurrence.members.map((member) => ({ type: "USER" as const, member }));
  let sentCount = 0;
  let failedCount = 0;
  for (const target of targets) {
    const key = target.type === "GROUP" ? `${prefix}:group` : `${prefix}:user:${target.member.userId}`;
    const deliveryId = await claimScheduleReminderDelivery(databasePool, {
      deliveryKey: key,
      scheduleId: occurrence.schedule.id,
      batchId: input.batchId,
      date: occurrence.date,
      time: occurrence.time,
      offsetMinutes: input.offsetMinutes,
      source,
      target: target.type,
      groupJid: target.type === "GROUP" ? target.groupJid : null,
      userId: target.type === "USER" ? target.member.userId : null,
      message: target.type === "GROUP" ? message : buildDirectScheduleReminderMessage(occurrence, target.member.username),
    });
    if (!deliveryId) continue;
    try {
      if (target.type === "GROUP") {
        await sender.sendGroupMessage(
          target.groupJid,
          message,
          occurrence.members.map((member) => `${member.phoneNumber}@s.whatsapp.net`),
        );
      } else {
        await sender.sendMessage(target.member.phoneNumber, buildDirectScheduleReminderMessage(occurrence, target.member.username));
      }
      await markScheduleReminderDelivery(databasePool, { id: deliveryId, status: "SENT" });
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      try {
        await markScheduleReminderDelivery(databasePool, { id: deliveryId, status: "FAILED", reason: errorReason(error) });
      } catch (markError) {
        logger.error({ error: markError, deliveryId }, "Status reminder jadwal gagal diperbarui.");
      }
      logger.error({ error, deliveryId }, "Pengiriman reminder jadwal gagal.");
    }
  }
  return { recipientCount: targets.length, sentCount, failedCount };
}

export async function dispatchManualScheduleReminder(input: {
  scheduleName: string;
  requestedBy?: string | null;
  sender: ScheduleMessageSender;
  now?: Date;
}): Promise<ReminderDispatchSummary & { occurrence: ScheduleOccurrence }> {
  const schedule = await findActiveScheduleByName(databasePool, input.scheduleName);
  if (!schedule) throw new Error("Jadwal tidak ditemukan atau tidak aktif.");
  const now = localNow(input.now);
  let occurrence: ScheduleOccurrence | undefined;
  for (let offset = 0; offset <= 366 && !occurrence; offset += 1) {
    const date = addDays(now.date, offset);
    const candidates = getScheduleOccurrencesOnDate(schedule, date);
    occurrence = candidates.find((candidate) => offset > 0 || candidate.time >= now.time);
  }
  if (!occurrence) throw new Error("Tidak ada occurrence jadwal dalam 12 bulan ke depan.");
  const batchId = await withTransaction((client) => createManualReminderBatch(client, {
    scheduleId: schedule.id,
    date: occurrence!.date,
    time: occurrence!.time,
    requestedBy: input.requestedBy ?? null,
  }));
  const result = await dispatchOccurrence(occurrence, "MANUAL", input.sender, { batchId });
  return { occurrence, occurrenceCount: 1, ...result };
}

/** Called once a minute by the worker.  Delivery keys make a 30-second tick idempotent. */
export async function dispatchAutomaticScheduleReminders(
  sender: ScheduleMessageSender,
  now = new Date(),
): Promise<ReminderDispatchSummary> {
  const schedules = await listActiveSchedules(databasePool);
  const local = localNow(now);
  const nowWall = toWallClockMilliseconds(local.date, local.time);
  let occurrenceCount = 0;
  let recipientCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  for (const schedule of schedules) {
    for (const offsetMinutes of schedule.reminderOffsetsMinutes) {
      const targetWall = new Date(nowWall - offsetMinutes * 60_000);
      const date = targetWall.toISOString().slice(0, 10);
      const time = targetWall.toISOString().slice(11, 16);
      const occurrences = getScheduleOccurrencesOnDate(schedule, date)
        .filter((occurrence) => occurrence.time === time);
      for (const occurrence of occurrences) {
        occurrenceCount += 1;
        const result = await dispatchOccurrence(occurrence, "AUTOMATIC", sender, { offsetMinutes });
        recipientCount += result.recipientCount;
        sentCount += result.sentCount;
        failedCount += result.failedCount;
      }
    }
  }
  return { occurrenceCount, recipientCount, sentCount, failedCount };
}
