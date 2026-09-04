import type { Pool, PoolClient } from "pg";

import type {
  ActivitySchedule,
  CreateActivityScheduleInput,
  ScheduleMember,
} from "./schedule.types.js";

type DatabaseExecutor = Pool | PoolClient;

interface ScheduleRow {
  id: string;
  nama: string;
  schedule_type: ActivitySchedule["type"];
  status: ActivitySchedule["status"];
  timezone: string;
  start_date: string;
  start_time: string;
  interval_value: number;
  weekly_days: number[];
  monthly_days: number[];
  custom_mode: ActivitySchedule["customMode"];
  custom_unit: ActivitySchedule["customUnit"];
  group_jid: string | null;
  reminder_offsets_minutes: number[];
}

interface MemberRow {
  user_id: string;
  username: string;
  nomor_whatsapp: string;
  weekday: number | null;
}

function mapSchedule(row: ScheduleRow): ActivitySchedule {
  return {
    id: row.id,
    name: row.nama,
    type: row.schedule_type,
    status: row.status,
    timezone: row.timezone,
    startDate: row.start_date,
    startTime: row.start_time.slice(0, 5),
    intervalValue: row.interval_value,
    weeklyDays: row.weekly_days ?? [],
    monthlyDays: row.monthly_days ?? [],
    customMode: row.custom_mode,
    customUnit: row.custom_unit,
    groupJid: row.group_jid,
    reminderOffsetsMinutes: row.reminder_offsets_minutes ?? [],
    members: [],
    customDates: [],
  };
}

function mapMember(row: MemberRow): ScheduleMember {
  return {
    userId: row.user_id,
    username: row.username,
    phoneNumber: row.nomor_whatsapp,
    weekday: row.weekday,
  };
}

const scheduleColumns = `
  id, nama, schedule_type, status, timezone, start_date::text, start_time::text,
  interval_value, weekly_days, monthly_days, custom_mode, custom_unit, group_jid,
  reminder_offsets_minutes`;

async function attachDetails(
  executor: DatabaseExecutor,
  schedules: ActivitySchedule[],
): Promise<ActivitySchedule[]> {
  if (schedules.length === 0) return schedules;
  const ids = schedules.map((schedule) => schedule.id);
  const [memberRows, customDateResult] = await Promise.all([
    executor.query<MemberRow & { schedule_id: string }>(
      `SELECT m.schedule_id, m.user_id, u.username, u.nomor_whatsapp, m.weekday
       FROM mifabot.activity_schedule_members m
       JOIN mifabot.users u ON u.id = m.user_id
       WHERE m.schedule_id = ANY($1::uuid[])
         AND u.status = 'AKTIF'
       ORDER BY m.weekday NULLS FIRST, LOWER(u.username), u.id`,
      [ids],
    ),
    executor.query<{ schedule_id: string; occurrence_date: string; occurrence_time: string }>(
      `SELECT schedule_id, occurrence_date::text, occurrence_time::text
       FROM mifabot.activity_schedule_custom_dates
       WHERE schedule_id = ANY($1::uuid[])
       ORDER BY occurrence_date, occurrence_time`,
      [ids],
    ),
  ]);
  const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  for (const row of memberRows.rows) {
    byId.get(row.schedule_id)?.members.push(mapMember(row));
  }
  for (const row of customDateResult.rows) {
    byId.get(row.schedule_id)?.customDates.push({
      date: row.occurrence_date,
      time: row.occurrence_time.slice(0, 5),
    });
  }
  return schedules;
}

export async function findActiveScheduleByName(
  executor: DatabaseExecutor,
  name: string,
): Promise<ActivitySchedule | null> {
  const result = await executor.query<ScheduleRow>(
    `SELECT ${scheduleColumns}
     FROM mifabot.activity_schedules
     WHERE LOWER(btrim(nama)) = LOWER(btrim($1))
       AND status = 'ACTIVE'
     LIMIT 1`,
    [name],
  );
  const schedule = result.rows[0] ? mapSchedule(result.rows[0]) : null;
  return schedule ? (await attachDetails(executor, [schedule]))[0] ?? null : null;
}

export async function listActiveSchedules(
  executor: DatabaseExecutor,
): Promise<ActivitySchedule[]> {
  const result = await executor.query<ScheduleRow>(
    `SELECT ${scheduleColumns}
     FROM mifabot.activity_schedules
     WHERE status = 'ACTIVE'
     ORDER BY LOWER(nama), id`,
  );
  return attachDetails(executor, result.rows.map(mapSchedule));
}

export async function insertActivitySchedule(
  client: PoolClient,
  input: CreateActivityScheduleInput,
): Promise<ActivitySchedule> {
  const result = await client.query<ScheduleRow>(
    `INSERT INTO mifabot.activity_schedules (
       nama, schedule_type, timezone, start_date, start_time, interval_value,
       weekly_days, monthly_days, custom_mode, custom_unit, group_jid,
       reminder_offsets_minutes, created_by
     ) VALUES (
       $1, $2::mifabot.activity_schedule_type, 'Asia/Jakarta', $3::date, $4::time,
       $5, $6::smallint[], $7::smallint[], $8::mifabot.activity_custom_schedule_mode,
       $9, $10, $11::smallint[], $12
     ) RETURNING ${scheduleColumns}`,
    [
      input.name,
      input.type,
      input.startDate,
      input.startTime,
      input.intervalValue ?? 1,
      input.weeklyDays ?? [],
      input.monthlyDays ?? [],
      input.customMode ?? null,
      input.customUnit ?? null,
      input.groupJid ?? null,
      input.reminderOffsetsMinutes ?? [-30, 0],
      input.createdBy ?? null,
    ],
  );
  const schedule = mapSchedule(result.rows[0]!);
  for (const member of input.members) {
    await client.query(
      `INSERT INTO mifabot.activity_schedule_members (schedule_id, user_id, weekday)
       VALUES ($1, $2, $3::smallint)`,
      [schedule.id, member.userId, member.weekday ?? null],
    );
  }
  for (const occurrence of input.customDates ?? []) {
    await client.query(
      `INSERT INTO mifabot.activity_schedule_custom_dates (
         schedule_id, occurrence_date, occurrence_time
       ) VALUES ($1, $2::date, $3::time)`,
      [schedule.id, occurrence.date, occurrence.time],
    );
  }
  return (await attachDetails(client, [schedule]))[0]!;
}

export async function createManualReminderBatch(
  client: PoolClient,
  input: { scheduleId: string; date: string; time: string; requestedBy: string | null },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO mifabot.activity_reminder_manual_batches (
       schedule_id, occurrence_date, occurrence_time, requested_by
     ) VALUES ($1, $2::date, $3::time, $4)
     RETURNING id`,
    [input.scheduleId, input.date, input.time, input.requestedBy],
  );
  return result.rows[0]!.id;
}

export async function claimScheduleReminderDelivery(
  executor: DatabaseExecutor,
  input: {
    deliveryKey: string;
    scheduleId: string;
    batchId?: string | null;
    date: string;
    time: string;
    offsetMinutes?: number | null;
    source: "AUTOMATIC" | "MANUAL";
    target: "GROUP" | "USER";
    groupJid?: string | null;
    userId?: string | null;
    message: string;
  },
): Promise<string | null> {
  const result = await executor.query<{ id: string }>(
    `INSERT INTO mifabot.activity_reminder_deliveries (
       delivery_key, schedule_id, manual_batch_id, occurrence_date, occurrence_time,
       reminder_offset_minutes, source, target_type, group_jid, user_id, message_body
     ) VALUES (
       $1, $2, $3, $4::date, $5::time, $6::smallint,
       $7::mifabot.activity_reminder_source, $8::mifabot.activity_reminder_target,
       $9, $10, $11
     ) ON CONFLICT (delivery_key) DO UPDATE
       SET status = 'PENDING', failure_reason = NULL, message_body = EXCLUDED.message_body,
           attempt_count = mifabot.activity_reminder_deliveries.attempt_count + 1,
           last_attempt_at = now()
       WHERE mifabot.activity_reminder_deliveries.status = 'FAILED'
     RETURNING id`,
    [
      input.deliveryKey,
      input.scheduleId,
      input.batchId ?? null,
      input.date,
      input.time,
      input.offsetMinutes ?? null,
      input.source,
      input.target,
      input.groupJid ?? null,
      input.userId ?? null,
      input.message,
    ],
  );
  return result.rows[0]?.id ?? null;
}

export async function markScheduleReminderDelivery(
  executor: DatabaseExecutor,
  input: { id: string; status: "SENT" | "FAILED"; reason?: string },
): Promise<void> {
  await executor.query(
    `UPDATE mifabot.activity_reminder_deliveries
     SET status = $2::mifabot.status_notifikasi,
         sent_at = CASE WHEN $2 = 'SENT' THEN now() ELSE NULL END,
         failure_reason = CASE WHEN $2 = 'FAILED' THEN $3 ELSE NULL END
     WHERE id = $1 AND status = 'PENDING'`,
    [input.id, input.status, input.reason?.slice(0, 2000) ?? null],
  );
}
