import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

import { env } from "../../config/env.js";
import { logger } from "../../core/logger/logger.js";
import {
  findActiveUserByIdentifier,
  listActiveStudents,
} from "../../modules/access/access.repository.js";
import {
  getActiveUserForWhatsAppNumber,
  getHelpForWhatsAppNumber,
} from "../../modules/access/help.service.js";
import {
  isRootAuthorization,
  normalizeWhatsAppNumber,
} from "../../modules/access/access.service.js";
import { buildProfileMessage } from "../../modules/access/profile.message.js";
import { buildStudentListMessage } from "../../modules/access/student-list.message.js";
import {
  addDefinitionResponsible,
  createBillingDefinition,
  deactivateDefinition,
  ensureCurrentBillsForUser,
  findDefinitionByName,
  generateCustomBillsForPeriod,
  getArrears,
  getCurrentBills,
  isDefinitionResponsible,
  listDefinitionsForAdmin,
  removeDefinitionResponsible,
  setBillingNominal,
} from "../../modules/billing/billing.service.js";
import {
  buildBillingDefinitionListMessage,
  buildBillsMessage,
} from "../../modules/billing/billing.message.js";
import type { Bill } from "../../modules/billing/billing.types.js";
import {
  buildManualGroupBillingReminderMessage,
  dispatchManualBillingReminders,
  getManualGroupBillingReminder,
  getManualReminderGroup,
  setBillingReminderRules,
  setManualReminderGroup,
} from "../../modules/notifications/reminder.service.js";
import {
  createActivitySchedule,
  dispatchManualScheduleReminder,
} from "../../modules/schedules/schedule.service.js";
import type {
  CreateActivityScheduleInput,
  CustomIntervalUnit,
  CustomScheduleMode,
  ScheduleType,
} from "../../modules/schedules/schedule.types.js";
import { importStudentsFromWorkbook } from "../../modules/users/student-import.service.js";
import { StudentImportValidationError } from "../../modules/users/student-import.types.js";
import {
  SelfProfileConflictError,
  SelfProfileValidationError,
  isWhatsAppNumberRegistered,
  registerSelfUser,
  updateOwnProfile,
} from "../../modules/users/self-profile.service.js";
import {
  getGroupId,
  getMessageText,
  getSenderPhoneNumber,
  isCancelCommand,
  isEditProfileCommand,
  isSelfRegistrationCommand,
  isSupportedConversation,
  normalizeSelfCommand,
  parseAdminArrearsPaymentCommand,
  parseAdminCurrentPaymentCommand,
  parseBillingReportCommand,
  parsePaymentReversalCommand,
  parseSelfProfileFieldChoice,
  parseArrearsPaymentCommand,
  parseBillingPaymentCommand,
  parseBillingResponsibleCommand,
  parseConfigureManualReminderGroupCommand,
  parseCreateBillingDefinitionCommand,
  parseDeleteBillingDefinitionCommand,
  parseIssueCustomBillingCommand,
  parseManualBillingReminderCommand,
  parseManualGroupBillingReminderCommand,
  parseManualScheduleReminderCommand,
  parsePaymentChannelCommand,
  parsePaymentDecisionCommand,
  parseRupiahAmount,
  parseSetBillingReminderCommand,
  parseSetBillingNominalCommand,
  isCreateScheduleCommand,
  isHelpCommand,
  isListBillingDefinitionsCommand,
  isListStudentsCommand,
} from "./message.js";
import {
  adminArrearsBillSelectionMessage,
  adminArrearsPaymentGuide,
  adminCurrentPaymentGuide,
  adminPaymentRecordedMessage,
  adminPaymentRecordedNotification,
  approvedPaymentsForReversalMessage,
  arrearsBillSelectionMessage,
  arrearsPaymentAmountPrompt,
  arrearsPaymentChannelChoice,
  arrearsPaymentGuide,
  arrearsPaymentSubmitted,
  billingPaymentAmountError,
  billingPaymentAmountPrompt,
  billingPaymentChannelChoice,
  billingPaymentGuide,
  billingPaymentProofRequest,
  billingPaymentSubmitted,
  paymentDecisionNotificationMessage,
  paymentDecisionSubmittedMessage,
  paymentReviewRequestMessage,
  pendingPaymentReviewsMessage,
  paymentReversalConfirmationMessage,
  paymentReversedMessage,
  paymentReversalNotificationMessage,
} from "../../modules/payments/monthly-payment.message.js";
import {
  decidePayment,
  claimNextPaymentReviewForReviewer,
  getActivePaymentReviewForReviewer,
  getPaymentChannels,
  getPendingPaymentsForReviewer,
  getApprovedPaymentsForReversal,
  reverseApprovedPayment,
  releasePaymentReview,
  submitAdminArrearsPayment,
  submitAdminCurrentPayment,
  submitUserArrearsPayment,
  submitUserCurrentPayment,
} from "../../modules/payments/payment.service.js";
import {
  createPaymentChannelForDefinition,
  deactivatePaymentChannelForDefinition,
  getPaymentChannelsForDefinition,
  updatePaymentChannelForDefinition,
  type PaymentChannelEditableField,
} from "../../modules/payments/payment-channel.service.js";
import type {
  ApprovedPaymentReview,
  Payment,
  PaymentChannel,
  PendingPaymentReview,
} from "../../modules/payments/payment.types.js";
import {
  exportArrearsReport,
  exportPaymentReport,
} from "../../modules/reports/payment-report.export.js";
import {
  arrearsReportMessage,
  paymentAuditMessage,
  paymentReportMessage,
} from "../../modules/reports/payment-report.message.js";
import {
  getArrearsReport,
  getPaymentAuditLog,
  getPaymentReport,
} from "../../modules/reports/payment-report.service.js";
import {
  createStorageProvider,
  isLocalProofStorageKey,
  proofFileName,
} from "../storage/storage.js";

let socket: WASocket | undefined;
let whatsappConnected = false;
let reconnectTimer: NodeJS.Timeout | undefined;
const pendingStudentImports = new Map<
  string,
  { actorUserId: string | null; expiresAt: number }
>();
const studentImportTimeoutMs = 10 * 60 * 1_000;
const maxStudentImportSizeBytes = 5 * 1024 * 1024;
const selfServiceConversationTimeoutMs = 10 * 60 * 1_000;

interface PendingCurrentBillingPayment {
  kind: "CURRENT";
  stage: "ENTER_AMOUNT" | "SELECT_CHANNEL";
  userId: string;
  billId: string;
  billingDefinitionId: string;
  billingName: string;
  billSisa: number;
  nominal?: number;
  channels: PaymentChannel[];
  selectedChannelId?: string;
  expiresAt: number;
}

interface PendingArrearsBillingPayment {
  kind: "ARREARS";
  userId: string;
  billingDefinitionId: string;
  billingName: string;
  bills: Bill[];
  selectedBillIds?: string[];
  selectedBills?: Bill[];
  nominal?: number;
  channels: PaymentChannel[];
  selectedChannelId?: string;
  stage: "SELECT_BILLS" | "ENTER_AMOUNT" | "SELECT_CHANNEL";
  expiresAt: number;
}

type PendingBillingPayment =
  | PendingCurrentBillingPayment
  | PendingArrearsBillingPayment;

const pendingBillingPayments = new Map<string, PendingBillingPayment>();
const pendingPaymentReversalLists = new Map<
  string,
  { actorUserId: string; payments: ApprovedPaymentReview[]; expiresAt: number }
>();
const pendingPaymentReversalConfirmations = new Map<
  string,
  { actorUserId: string; payment: ApprovedPaymentReview; reason: string; expiresAt: number }
>();

interface PendingAdminArrearsPayment {
  adminUserId: string;
  studentUserId: string;
  studentName: string;
  studentWhatsAppNumber: string;
  billingDefinitionId: string;
  billingName: string;
  bills: Bill[];
  expiresAt: number;
}

const pendingAdminArrearsPayments = new Map<
  string,
  PendingAdminArrearsPayment
>();

type SelfRegistrationStage =
  | "FULL_NAME"
  | "USERNAME"
  | "PHONE_NUMBER"
  | "GENDER";

interface PendingSelfRegistration {
  stage: SelfRegistrationStage;
  fullName?: string;
  username?: string;
  phoneNumber?: string;
  expiresAt: number;
}

interface PendingProfileEdit {
  userId: string;
  field?: "fullName" | "username" | "phoneNumber" | "gender";
  expiresAt: number;
}

type PaymentChannelSetupStage =
  | "METHOD"
  | "NAME"
  | "ACCOUNT_NUMBER"
  | "ACCOUNT_HOLDER"
  | "CASH_INSTRUCTION"
  | "CONFIRM";

interface PendingPaymentChannelSetup {
  billingDefinitionId: string;
  billingName: string;
  ownerUserId: string;
  ownerUsername: string;
  stage: PaymentChannelSetupStage;
  method?: "BANK_TRANSFER" | "E_WALLET" | "CASH";
  name?: string;
  accountNumber?: string;
  accountHolder?: string;
  cashInstruction?: string;
  expiresAt: number;
}

interface PendingPaymentChannelEdit {
  billingDefinitionId: string;
  billingName: string;
  channel: PaymentChannel;
  field?: PaymentChannelEditableField;
  expiresAt: number;
}

interface PendingPaymentChannelDeactivation {
  billingDefinitionId: string;
  billingName: string;
  channel: PaymentChannel;
  expiresAt: number;
}

const pendingSelfRegistrations = new Map<string, PendingSelfRegistration>();
const pendingProfileEdits = new Map<string, PendingProfileEdit>();
const pendingPaymentChannelSetups = new Map<string, PendingPaymentChannelSetup>();
const pendingPaymentChannelEdits = new Map<string, PendingPaymentChannelEdit>();
const pendingPaymentChannelDeactivations = new Map<string, PendingPaymentChannelDeactivation>();
type ScheduleCreationStage =
  | "NAME"
  | "TYPE"
  | "CUSTOM_MODE"
  | "START"
  | "TIME"
  | "WEEKLY_DAYS"
  | "MONTHLY_DAYS"
  | "CUSTOM_INTERVAL"
  | "CUSTOM_DATES"
  | "ROSTER_MODE"
  | "MEMBERS"
  | "DAILY_ROSTER"
  | "GROUP"
  | "REMINDERS"
  | "CONFIRM";

interface PendingScheduleCreation {
  actorUserId: string | null;
  stage: ScheduleCreationStage;
  name?: string;
  type?: ScheduleType;
  startDate?: string;
  startTime?: string;
  intervalValue?: number;
  weeklyDays?: number[];
  monthlyDays?: number[];
  customMode?: CustomScheduleMode;
  customUnit?: CustomIntervalUnit;
  customDates?: Array<{ date: string; time: string }>;
  memberSpecs?: Array<{ identifiers: string[]; weekday?: number | null }>;
  groupJid?: string | null;
  reminderOffsetsMinutes?: number[];
  expiresAt: number;
}

const pendingScheduleCreations = new Map<string, PendingScheduleCreation>();
const proofStorage = createStorageProvider();

function currentDateInAppTimezone(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const weekdayLookup: Record<string, number> = {
  senin: 1,
  selasa: 2,
  rabu: 3,
  kamis: 4,
  jumat: 5,
  "jum'at": 5,
  sabtu: 6,
  minggu: 7,
  ahad: 7,
};

function parseScheduleStart(value: string): { date: string; time: string } | null {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):[0-5]\d$/);
  return match ? { date: match[1], time: match[2] } : null;
}

function parseScheduleTime(value: string): string | null {
  const time = value.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
}

function parseScheduleWeekdays(value: string): number[] | null {
  const parts = value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const days = parts.map((part) => weekdayLookup[part]);
  return days.some((day) => !day) || new Set(days).size !== days.length
    ? null
    : days.sort((a, b) => a - b);
}

function parseMonthlyScheduleDays(value: string): number[] | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  return parts.length === 0 || parts.some((day) => !Number.isSafeInteger(day) || day < 1 || day > 31)
    || new Set(parts).size !== parts.length
    ? null
    : parts.sort((a, b) => a - b);
}

function parseScheduleMemberIdentifiers(value: string): string[] | null {
  const identifiers = value.split(",").map((part) => part.trim().replace(/^@/, "")).filter(Boolean);
  return identifiers.length > 0 ? identifiers : null;
}

function parseDailyScheduleRoster(value: string): Array<{ identifiers: string[]; weekday: number }> | null {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length === 0) return null;
  const roster: Array<{ identifiers: string[]; weekday: number }> = [];
  for (const row of rows) {
    const match = row.match(/^([^:]+):\s*(.+)$/);
    if (!match) return null;
    const weekday = weekdayLookup[match[1].trim().toLowerCase()];
    const identifiers = parseScheduleMemberIdentifiers(match[2]);
    if (!weekday || !identifiers || roster.some((entry) => entry.weekday === weekday)) return null;
    roster.push({ weekday, identifiers });
  }
  return roster.sort((a, b) => a.weekday - b.weekday);
}

function parseScheduleReminderOffsets(value: string): number[] | null {
  const entries = value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const offsets = entries.map((entry) => {
    const normalized = entry.replace(/^h/i, "");
    return /^[-+]?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  });
  return offsets.some((offset) => !Number.isSafeInteger(offset)) || new Set(offsets).size !== offsets.length
    ? null
    : offsets.sort((a, b) => a - b);
}

function parseCustomScheduleDates(value: string): Array<{ date: string; time: string }> | null {
  const entries = value.split(",").map((part) => parseScheduleStart(part)).filter((entry): entry is { date: string; time: string } => entry !== null);
  return entries.length === 0 || entries.length !== value.split(",").length
    ? null
    : entries.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function scheduleCreationSummary(pending: PendingScheduleCreation): string {
  const type = ({ DAILY: "Harian", WEEKLY: "Mingguan", MONTHLY: "Bulanan", CUSTOM: "Custom" } as const)[pending.type!];
  const pattern = pending.type === "DAILY"
    ? `Setiap ${pending.intervalValue} hari`
    : pending.type === "WEEKLY"
      ? `Setiap ${pending.intervalValue} minggu; hari: ${(pending.weeklyDays ?? []).map((day) => Object.keys(weekdayLookup).find((key) => weekdayLookup[key] === day && key !== "ahad" && key !== "jum'at") ?? day).join(", ")}`
      : pending.type === "MONTHLY"
        ? `Setiap ${pending.intervalValue} bulan; tanggal: ${(pending.monthlyDays ?? []).join(", ")}`
        : pending.customMode === "DATES"
          ? `${pending.customDates?.length ?? 0} tanggal khusus`
          : `Setiap ${pending.intervalValue} ${pending.customUnit?.toLowerCase()}`;
  const members = (pending.memberSpecs ?? []).reduce((count, entry) => count + entry.identifiers.length, 0);
  return [
    "*KONFIRMASI JADWAL*",
    `Kegiatan: ${pending.name}`,
    `Jenis: ${type}`,
    `Pola: ${pattern}`,
    `Mulai: ${pending.startDate} ${pending.startTime} WIB`,
    `Petugas: ${members} user`,
    `Grup: ${pending.groupJid ?? "Tidak ada (reminder dikirim pribadi)"}`,
    `Reminder (menit): ${(pending.reminderOffsetsMinutes ?? []).join(", ")}`,
    "",
    "Balas Ya untuk menyimpan atau Batal untuk membatalkan.",
  ].join("\n");
}

function isExcelDocument(message: WAMessage): boolean {
  const document = message.message?.documentMessage;
  if (!document) return false;

  const fileName = document.fileName?.toLowerCase() ?? "";
  return (
    document.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    fileName.endsWith(".xlsx")
  );
}

function studentImportInstructions(): string {
  return [
    "*DATA SANTRI*",
    "",
    "Kirim file Excel (.xlsx) dalam 10 menit. Sheet pertama wajib memiliki kolom berikut:",
    "• Nama Lengkap",
    "• Username",
    "• Nomor Whatsapp",
    "• Jenis Kelamin (L/P)",
    "",
    "Nominal tagihan diatur terpisah melalui command Set nominal. Data akan disimpan seluruhnya atau dibatalkan seluruhnya bila ada baris yang tidak valid.",
  ].join("\n");
}

function formatRupiah(nominal: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(nominal)}`;
}

function formatBillingInterval(
  interval: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM",
): string {
  const labels = {
    WEEKLY: "Mingguan",
    MONTHLY: "Bulanan",
    YEARLY: "Tahunan",
    CUSTOM: "Custom",
  } as const;
  return labels[interval];
}

function formatReminderOffset(offset: number): string {
  if (offset === 0) return "H-0";
  return `H${offset > 0 ? "+" : ""}${offset}`;
}

function commandFailureMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;

  const safeDomainMessages = [
    "Nama tagihan sudah digunakan.",
    "Nama tagihan harus terdiri dari 3 sampai 100 karakter.",
    "Nominal tagihan harus berupa bilangan bulat positif.",
    "Definisi tagihan tidak aktif atau tidak ditemukan.",
    "Definisi tagihan tidak ditemukan.",
    "Penanggung jawab harus user aktif.",
    "User bukan penanggung jawab aktif tagihan ini.",
    "Tagihan aktif harus memiliki minimal satu penanggung jawab.",
    "Semua penerima nominal khusus harus merupakan santri aktif.",
    "Penerbitan manual hanya dapat digunakan untuk tagihan custom.",
    "Tanggal harus menggunakan format YYYY-MM-DD.",
    "Tanggal tidak valid.",
    "Offset reminder harus berupa jumlah hari antara -32768 dan 32767.",
    "Offset reminder tidak boleh duplikat.",
    "Tagihan tidak ditemukan atau belum aktif.",
    "PJ yang dipilih bukan PJ aktif untuk tagihan ini.",
    "Metode pembayaran aktif tidak ditemukan.",
    "Nama metode wajib diisi.",
    "Nomor rekening/e-wallet wajib diisi.",
    "Nama pemilik wajib diisi.",
    "Instruksi Cash wajib diisi.",
  ];
  return safeDomainMessages.includes(error.message) ? error.message : fallback;
}

function selfRegistrationInstructions(): string {
  return [
    "*PENDAFTARAN USER*",
    "Ketik Batal kapan saja untuk membatalkan pendaftaran.",
    "",
    "Masukkan nama lengkap:",
  ].join("\n");
}

function editProfileInstructions(): string {
  return [
    "*EDIT PROFILE*",
    "Pilih data yang ingin diubah:",
    "1. Nama lengkap",
    "2. Username",
    "3. Nomor WhatsApp",
    "4. Jenis kelamin",
    "",
    "Balas dengan angka 1-4. Ketik Batal untuk membatalkan.",
  ].join("\n");
}

function paymentChannelMethodInstructions(): string {
  return [
    "*TAMBAH METODE PEMBAYARAN*",
    "Pilih jenis metode:",
    "1. Rekening Bank",
    "2. E-Wallet",
    "3. Cash",
    "",
    "Balas dengan angka 1-3. Ketik Batal untuk membatalkan.",
  ].join("\n");
}

function paymentMethodLabel(method: PaymentChannel["metode"]): string {
  if (method === "BANK_TRANSFER") return "Rekening Bank";
  if (method === "CASH") return "Cash";
  return "E-Wallet";
}

function paymentChannelDetails(channel: PaymentChannel): string[] {
  const details = [`Jenis: ${paymentMethodLabel(channel.metode)}`];
  if (channel.metode === "CASH") {
    details.push(`Instruksi: ${channel.instruksi ?? "-"}`);
  } else {
    details.push(`Nomor: ${channel.nomorRekening ?? "-"}`);
    details.push(`Pemilik: ${channel.namaPemilik ?? "-"}`);
  }
  return details;
}

function paymentChannelsMessage(
  billingName: string,
  channels: PaymentChannel[],
): string {
  if (channels.length === 0) {
    return [
      "*METODE PEMBAYARAN*",
      `Tagihan: ${billingName}`,
      "Belum ada metode pembayaran aktif.",
      "Tambahkan dengan: Tambah metode <nama tagihan> <PJ>",
    ].join("\n");
  }

  return [
    "*METODE PEMBAYARAN*",
    `Tagihan: ${billingName}`,
    "Urutan tetap: Rekening Bank, E-Wallet, Cash.",
    "",
    ...channels.flatMap((channel, index) => [
      `${index + 1}. *${channel.nama}*`,
      ...paymentChannelDetails(channel).map((detail) => `   ${detail}`),
    ]),
    "",
    "Ubah: Ubah metode <nama tagihan> <nomor>",
    "Nonaktifkan: Nonaktifkan metode <nama tagihan> <nomor>",
  ].join("\n");
}

function profileFieldLabel(
  field: "fullName" | "username" | "phoneNumber" | "gender",
): string {
  const labels = {
    fullName: "nama lengkap",
    username: "username",
    phoneNumber: "nomor WhatsApp",
    gender: "jenis kelamin",
  } as const;
  return labels[field];
}

function profileFieldPrompt(
  field: "fullName" | "username" | "phoneNumber" | "gender",
): string {
  const prompts = {
    fullName: "Masukkan nama lengkap baru:",
    username: "Masukkan username baru (3-60 karakter; huruf, angka, titik, strip, atau underscore):",
    phoneNumber: "Masukkan nomor WhatsApp baru:",
    gender: "Masukkan jenis kelamin baru: L atau P.",
  } as const;
  return prompts[field];
}

function normalizeConversationValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSelfServicePhoneNumber(value: string): string | null {
  const normalized = normalizeWhatsAppNumber(value);
  return normalized && /^[1-9][0-9]{7,14}$/.test(normalized)
    ? normalized
    : null;
}

function parseProfileFieldValue(
  field: "fullName" | "username" | "phoneNumber" | "gender",
  text: string,
  senderPhoneNumber: string,
  requireSenderPhoneMatch = false,
): { value: string } | { error: string } {
  const value = normalizeConversationValue(text);

  if (field === "fullName") {
    if (!value) {
      return { error: "Nama lengkap wajib diisi." };
    }
    return value.length <= 200
      ? { value }
      : { error: "Nama lengkap maksimal 200 karakter." };
  }

  if (field === "username") {
    return /^[a-zA-Z0-9._-]{3,60}$/.test(value)
      ? { value }
      : {
          error:
            "Username harus 3-60 karakter dan hanya boleh berisi huruf, angka, titik, strip, atau underscore.",
        };
  }

  if (field === "phoneNumber") {
    const phoneNumber = normalizeSelfServicePhoneNumber(value);
    const sender = normalizeSelfServicePhoneNumber(senderPhoneNumber);
    if (!phoneNumber) {
      return { error: "Nomor WhatsApp tidak valid." };
    }
    if (requireSenderPhoneMatch && (!sender || phoneNumber !== sender)) {
      return {
        error:
          "Nomor WhatsApp harus sama dengan nomor yang digunakan untuk chat ini.",
      };
    }
    return { value: phoneNumber };
  }

  const gender = value.toUpperCase();
  return gender === "L" || gender === "P"
    ? { value: gender }
    : { error: "Jenis kelamin harus diisi dengan L atau P." };
}

function selfProfileFailureMessage(error: unknown, fallback: string): string {
  if (
    error instanceof SelfProfileValidationError ||
    error instanceof SelfProfileConflictError
  ) {
    return error.message;
  }
  return fallback;
}

async function replyToConversation(
  message: WAMessage,
  text: string,
): Promise<void> {
  await socket?.sendMessage(message.key.remoteJid!, { text });
}

/**
 * Delivers only the head of a PJ's payment queue. The claim is persisted
 * before the WhatsApp send, and released again if delivery itself fails.
 */
async function sendNextPaymentReviewToPj(reviewerId: string): Promise<void> {
  let payment: PendingPaymentReview | null = null;
  try {
    payment = await claimNextPaymentReviewForReviewer(reviewerId);
    if (!payment) return;

    const queue = await getPendingPaymentsForReviewer(reviewerId);
    const waitingCount = Math.max(0, queue.length - 1);
    const reviewerJid = `${payment.reviewerWhatsAppNumber}@s.whatsapp.net`;
    const reviewMessage = paymentReviewRequestMessage(payment, waitingCount);

    if (
      payment.proofStorageKey &&
      isLocalProofStorageKey(payment.proofStorageKey)
    ) {
      const proof = await proofStorage.get(payment.proofStorageKey);
      await socket?.sendMessage(reviewerJid, {
        image: proof,
        caption: reviewMessage,
      });
    } else {
      await socket?.sendMessage(reviewerJid, { text: reviewMessage });
    }
  } catch (error) {
    if (payment) {
      try {
        await releasePaymentReview(payment.id, reviewerId);
      } catch (releaseError) {
        logger.error(
          { error: releaseError, paymentId: payment.id, reviewerId },
          "Gagal mengembalikan pengajuan ke antrean PJ setelah notifikasi gagal.",
        );
      }
    }
    logger.error(
      { error, reviewerId, paymentId: payment?.id },
      "Gagal mengirim pengajuan pembayaran berikutnya ke PJ.",
    );
  }
}

async function handlePendingPaymentReversalConfirmation(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingPaymentReversalConfirmations.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingPaymentReversalConfirmations.delete(phoneNumber);
    await replyToConversation(message, "Konfirmasi reversal sudah kedaluwarsa. Ketik Riwayat pembayaran lagi.");
    return true;
  }

  const answer = normalizeSelfCommand(text);
  if (answer === "tidak") {
    pendingPaymentReversalConfirmations.delete(phoneNumber);
    await replyToConversation(message, "Reversal pembayaran dibatalkan.");
    return true;
  }
  if (answer !== "ya") {
    await replyToConversation(message, "Balas Ya untuk melanjutkan atau Tidak/Batal untuk membatalkan reversal.");
    return true;
  }

  try {
    const result = await reverseApprovedPayment({
      paymentId: pending.payment.id,
      reversedBy: pending.actorUserId,
      reason: pending.reason,
    });
    pendingPaymentReversalConfirmations.delete(phoneNumber);
    pendingPaymentReversalLists.delete(phoneNumber);
    await replyToConversation(message, paymentReversedMessage({
      payment: pending.payment,
      reason: result.reversal.reason,
    }));
    try {
      await socket?.sendMessage(`${pending.payment.payerWhatsAppNumber}@s.whatsapp.net`, {
        text: paymentReversalNotificationMessage({
          billingName: pending.payment.billingName,
          nominal: pending.payment.nominal,
          reason: result.reversal.reason,
        }),
      });
    } catch (notificationError) {
      logger.warn(
        { error: notificationError, paymentId: pending.payment.id },
        "Reversal pembayaran tersimpan, tetapi notifikasi santri gagal dikirim.",
      );
    }
  } catch (error) {
    pendingPaymentReversalConfirmations.delete(phoneNumber);
    logger.error({ error, paymentId: pending.payment.id }, "Reversal pembayaran gagal disimpan.");
    await replyToConversation(message, "Reversal gagal disimpan karena status atau alokasi pembayaran telah berubah. Ketik Riwayat pembayaran untuk memperbarui data.");
  }
  return true;
}

async function handlePendingSelfRegistration(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingSelfRegistrations.get(phoneNumber);
  if (!pending) return false;

  if (pending.expiresAt < Date.now()) {
    pendingSelfRegistrations.delete(phoneNumber);
    await replyToConversation(
      message,
      "Sesi pendaftaran sudah kedaluwarsa. Ketik Daftar untuk memulai kembali.",
    );
    return true;
  }

  if (pending.stage === "FULL_NAME") {
    const value = parseProfileFieldValue("fullName", text, phoneNumber);
    if ("error" in value) {
      await replyToConversation(message, `${value.error}\n\nMasukkan nama lengkap:`);
      return true;
    }
    pending.fullName = value.value;
    pending.stage = "USERNAME";
    await replyToConversation(
      message,
      "Buat username (disarankan memakai nama panggilan satu kata):",
    );
    return true;
  }

  if (pending.stage === "USERNAME") {
    const value = parseProfileFieldValue("username", text, phoneNumber);
    if ("error" in value) {
      await replyToConversation(message, `${value.error}\n\nMasukkan username:`);
      return true;
    }
    pending.username = value.value;
    pending.stage = "PHONE_NUMBER";
    await replyToConversation(
      message,
      "Masukkan nomor WhatsApp. Nomor harus sama dengan nomor yang digunakan untuk chat ini:",
    );
    return true;
  }

  if (pending.stage === "PHONE_NUMBER") {
    const value = parseProfileFieldValue(
      "phoneNumber",
      text,
      phoneNumber,
      true,
    );
    if ("error" in value) {
      await replyToConversation(
        message,
        `${value.error}\n\nMasukkan nomor WhatsApp:`,
      );
      return true;
    }
    pending.phoneNumber = value.value;
    pending.stage = "GENDER";
    await replyToConversation(message, "Masukkan jenis kelamin: L atau P.");
    return true;
  }

  const gender = parseProfileFieldValue("gender", text, phoneNumber);
  if ("error" in gender) {
    await replyToConversation(message, `${gender.error}\n\nMasukkan jenis kelamin: L atau P.`);
    return true;
  }

  if (!pending.fullName || !pending.username || !pending.phoneNumber) {
    pendingSelfRegistrations.delete(phoneNumber);
    await replyToConversation(
      message,
      "Data pendaftaran tidak lengkap. Ketik Daftar untuk memulai kembali.",
    );
    return true;
  }

  try {
    await registerSelfUser({
      fullName: pending.fullName,
      username: pending.username,
      phoneNumber: pending.phoneNumber,
      gender: gender.value as "L" | "P",
      senderPhoneNumber: phoneNumber,
    });
    pendingSelfRegistrations.delete(phoneNumber);
    await replyToConversation(
      message,
      [
        "*PENDAFTARAN BERHASIL*",
        `Nama: ${pending.fullName}`,
        `Username: ${pending.username}`,
        `Nomor WhatsApp: ${pending.phoneNumber}`,
        `Jenis kelamin: ${gender.value}`,
        "",
        "Gunakan Cek profil untuk melihat data Anda.",
      ].join("\n"),
    );
  } catch (error) {
    logger.error({ error }, "Pendaftaran user mandiri gagal.");
    const messageText = selfProfileFailureMessage(
      error,
      "Pendaftaran gagal diproses. Coba lagi nanti.",
    );
    if (
      error instanceof SelfProfileConflictError &&
      /username/i.test(error.message)
    ) {
      pending.stage = "USERNAME";
      pending.phoneNumber = undefined;
      await replyToConversation(
        message,
        `${messageText}\n\nMasukkan username lain:`,
      );
    } else {
      pendingSelfRegistrations.delete(phoneNumber);
      await replyToConversation(
        message,
        `${messageText}\n\nKetik Daftar untuk memulai pendaftaran kembali.`,
      );
    }
  }
  return true;
}

async function handlePendingProfileEdit(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingProfileEdits.get(phoneNumber);
  if (!pending) return false;

  if (pending.expiresAt < Date.now()) {
    pendingProfileEdits.delete(phoneNumber);
    await replyToConversation(
      message,
      "Sesi Edit profile sudah kedaluwarsa. Ketik Edit profile untuk memulai kembali.",
    );
    return true;
  }

  if (!pending.field) {
    const field = parseSelfProfileFieldChoice(text);
    if (!field) {
      await replyToConversation(
        message,
        `Pilihan tidak valid.\n\n${editProfileInstructions()}`,
      );
      return true;
    }
    pending.field = field;
    await replyToConversation(message, profileFieldPrompt(field));
    return true;
  }

  const parsedValue = parseProfileFieldValue(
    pending.field,
    text,
    phoneNumber,
  );
  if ("error" in parsedValue) {
    await replyToConversation(
      message,
      `${parsedValue.error}\n\n${profileFieldPrompt(pending.field)}`,
    );
    return true;
  }

  try {
    await updateOwnProfile({
      userId: pending.userId,
      field: pending.field,
      value: parsedValue.value,
    });
    const field = pending.field;
    pendingProfileEdits.delete(phoneNumber);
    await replyToConversation(
      message,
      [
        "*PROFIL BERHASIL DIPERBARUI*",
        `${profileFieldLabel(field)} telah diperbarui.`,
        "Ketik Edit profile bila ingin mengubah data lain.",
      ].join("\n"),
    );
  } catch (error) {
    logger.error({ error, userId: pending.userId }, "Edit profile mandiri gagal.");
    await replyToConversation(
      message,
      `${selfProfileFailureMessage(error, "Profil gagal diperbarui. Coba lagi nanti.")}\n\n${profileFieldPrompt(pending.field)}`,
    );
  }
  return true;
}

async function handlePendingPaymentChannelSetup(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingPaymentChannelSetups.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingPaymentChannelSetups.delete(phoneNumber);
    await replyToConversation(message, "Sesi pengaturan metode sudah kedaluwarsa. Mulai kembali dengan Tambah metode.");
    return true;
  }

  const value = normalizeConversationValue(text);
  let justEnteredConfirmation = false;
  if (pending.stage === "METHOD") {
    const method = ({ "1": "BANK_TRANSFER", "2": "E_WALLET", "3": "CASH" } as const)[value as "1" | "2" | "3"];
    if (!method) {
      await replyToConversation(message, `Pilihan tidak valid.\n\n${paymentChannelMethodInstructions()}`);
      return true;
    }
    pending.method = method;
    pending.stage = "NAME";
    await replyToConversation(message, "Masukkan nama tampilan metode pembayaran:");
    return true;
  }

  if (pending.stage === "NAME") {
    if (!value || value.length > 100) {
      await replyToConversation(message, "Nama metode wajib diisi dan maksimal 100 karakter.");
      return true;
    }
    pending.name = value;
    if (pending.method === "CASH") {
      pending.stage = "CASH_INSTRUCTION";
      await replyToConversation(message, "Masukkan instruksi atau lokasi pembayaran Cash:");
    } else {
      pending.stage = "ACCOUNT_NUMBER";
      await replyToConversation(message, "Masukkan nomor rekening atau nomor E-Wallet:");
    }
    return true;
  }

  if (pending.stage === "ACCOUNT_NUMBER") {
    if (!value || value.length > 100) {
      await replyToConversation(message, "Nomor rekening/E-Wallet wajib diisi dan maksimal 100 karakter.");
      return true;
    }
    pending.accountNumber = value;
    pending.stage = "ACCOUNT_HOLDER";
    await replyToConversation(message, "Masukkan nama pemilik rekening atau E-Wallet:");
    return true;
  }

  if (pending.stage === "ACCOUNT_HOLDER") {
    if (!value || value.length > 200) {
      await replyToConversation(message, "Nama pemilik wajib diisi dan maksimal 200 karakter.");
      return true;
    }
    pending.accountHolder = value;
    pending.stage = "CONFIRM";
    justEnteredConfirmation = true;
  } else if (pending.stage === "CASH_INSTRUCTION") {
    if (!value || value.length > 1000) {
      await replyToConversation(message, "Instruksi Cash wajib diisi dan maksimal 1000 karakter.");
      return true;
    }
    pending.cashInstruction = value;
    pending.stage = "CONFIRM";
    justEnteredConfirmation = true;
  }

  if (pending.stage !== "CONFIRM") return true;

  if (justEnteredConfirmation) {
    await replyToConversation(message, [
      "Periksa kembali data berikut:",
      `Tagihan: ${pending.billingName}`,
      `PJ: ${pending.ownerUsername}`,
      `Nama: ${pending.name}`,
      `Jenis: ${paymentMethodLabel(pending.method!)}`,
      ...(pending.method === "CASH"
        ? [`Instruksi: ${pending.cashInstruction}`]
        : [`Nomor: ${pending.accountNumber}`, `Pemilik: ${pending.accountHolder}`]),
      "",
      "Balas Ya untuk menyimpan atau Tidak untuk membatalkan.",
    ].join("\n"));
    return true;
  }

  if (normalizeSelfCommand(text) === "ya") {
    try {
      const channel = await createPaymentChannelForDefinition({
        billingDefinitionId: pending.billingDefinitionId,
        adminUserId: pending.ownerUserId,
        nama: pending.name!,
        metode: pending.method!,
        nomorRekening: pending.accountNumber,
        namaPemilik: pending.accountHolder,
        instruksi: pending.cashInstruction,
      });
      pendingPaymentChannelSetups.delete(phoneNumber);
      await replyToConversation(message, [
        "*METODE PEMBAYARAN DITAMBAHKAN*",
        `Tagihan: ${pending.billingName}`,
        `PJ: ${pending.ownerUsername}`,
        `Nama: ${channel.nama}`,
        ...paymentChannelDetails(channel),
      ].join("\n"));
    } catch (error) {
      logger.error({ error }, "Gagal menambah metode pembayaran.");
      pendingPaymentChannelSetups.delete(phoneNumber);
      await replyToConversation(message, commandFailureMessage(error, "Metode pembayaran gagal ditambahkan. Mulai kembali dengan Tambah metode."));
    }
    return true;
  }
  if (normalizeSelfCommand(text) === "tidak") {
    pendingPaymentChannelSetups.delete(phoneNumber);
    await replyToConversation(message, "Penambahan metode pembayaran dibatalkan.");
    return true;
  }

  await replyToConversation(message, "Balas Ya untuk menyimpan atau Tidak untuk membatalkan.");
  return true;
}

async function handlePendingPaymentChannelEdit(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingPaymentChannelEdits.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingPaymentChannelEdits.delete(phoneNumber);
    await replyToConversation(message, "Sesi ubah metode sudah kedaluwarsa.");
    return true;
  }

  if (!pending.field) {
    const choices: Record<string, PaymentChannelEditableField> =
      pending.channel.metode === "CASH"
        ? { "1": "nama", "2": "instruksi" }
        : { "1": "nama", "2": "nomorRekening", "3": "namaPemilik" };
    const selected = choices[normalizeSelfCommand(text)];
    if (!selected) {
      const menu = pending.channel.metode === "CASH"
        ? "1. Nama tampilan\n2. Instruksi Cash"
        : "1. Nama tampilan\n2. Nomor rekening/E-Wallet\n3. Nama pemilik";
      await replyToConversation(message, `Pilihan tidak valid.\n${menu}`);
      return true;
    }
    pending.field = selected;
    await replyToConversation(message, "Masukkan nilai baru:");
    return true;
  }

  try {
    const channel = await updatePaymentChannelForDefinition({
      billingDefinitionId: pending.billingDefinitionId,
      channelId: pending.channel.id,
      field: pending.field,
      value: text,
    });
    pendingPaymentChannelEdits.delete(phoneNumber);
    await replyToConversation(message, [
      "*METODE PEMBAYARAN DIPERBARUI*",
      `Tagihan: ${pending.billingName}`,
      `Nama: ${channel.nama}`,
      ...paymentChannelDetails(channel),
    ].join("\n"));
  } catch (error) {
    await replyToConversation(message, commandFailureMessage(error, "Metode pembayaran gagal diperbarui. Masukkan nilai baru yang valid atau ketik Batal."));
  }
  return true;
}

async function handlePendingPaymentChannelDeactivation(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingPaymentChannelDeactivations.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingPaymentChannelDeactivations.delete(phoneNumber);
    await replyToConversation(message, "Sesi nonaktifkan metode sudah kedaluwarsa.");
    return true;
  }
  const answer = normalizeSelfCommand(text);
  if (answer === "tidak") {
    pendingPaymentChannelDeactivations.delete(phoneNumber);
    await replyToConversation(message, "Metode pembayaran tetap aktif.");
    return true;
  }
  if (answer !== "ya") {
    await replyToConversation(message, "Balas Ya untuk menonaktifkan atau Tidak untuk membatalkan.");
    return true;
  }
  try {
    await deactivatePaymentChannelForDefinition({
      billingDefinitionId: pending.billingDefinitionId,
      channelId: pending.channel.id,
    });
    pendingPaymentChannelDeactivations.delete(phoneNumber);
    await replyToConversation(message, `Metode *${pending.channel.nama}* untuk tagihan ${pending.billingName} telah dinonaktifkan. Histori pembayaran tetap tersimpan.`);
  } catch (error) {
    logger.error({ error }, "Gagal menonaktifkan metode pembayaran.");
    pendingPaymentChannelDeactivations.delete(phoneNumber);
    await replyToConversation(message, commandFailureMessage(error, "Metode pembayaran gagal dinonaktifkan."));
  }
  return true;
}

async function handlePendingScheduleCreation(
  message: WAMessage,
  phoneNumber: string,
  text: string,
): Promise<boolean> {
  const pending = pendingScheduleCreations.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingScheduleCreations.delete(phoneNumber);
    await replyToConversation(message, "Sesi pembuatan jadwal sudah kedaluwarsa. Mulai lagi dengan Buat jadwal.");
    return true;
  }
  const value = text.trim();
  const normalized = normalizeSelfCommand(text);
  const advanceToGroup = async (): Promise<boolean> => {
    pending.stage = "GROUP";
    await replyToConversation(message, "Masukkan ID grup tujuan dari command Idgrup, atau kirim - untuk reminder pribadi ke petugas.");
    return true;
  };

  if (pending.stage === "NAME") {
    if (!value || value.length > 150) {
      await replyToConversation(message, "Nama kegiatan wajib diisi dan maksimal 150 karakter.");
      return true;
    }
    pending.name = value.replace(/\s+/g, " ");
    pending.stage = "TYPE";
    await replyToConversation(message, "Pilih jenis jadwal:\n1. Harian\n2. Mingguan\n3. Bulanan\n4. Custom");
    return true;
  }

  if (pending.stage === "TYPE") {
    const types: Record<string, ScheduleType> = {
      "1": "DAILY", harian: "DAILY", "2": "WEEKLY", mingguan: "WEEKLY",
      "3": "MONTHLY", bulanan: "MONTHLY", "4": "CUSTOM", custom: "CUSTOM",
    };
    const type = types[normalized];
    if (!type) {
      await replyToConversation(message, "Pilihan tidak valid. Balas Harian, Mingguan, Bulanan, atau Custom.");
      return true;
    }
    pending.type = type;
    if (type !== "CUSTOM") {
      pending.startDate = currentDateInAppTimezone();
      pending.intervalValue = 1;
      pending.stage = "TIME";
      await replyToConversation(
        message,
        `Masukkan jam kegiatan. Format: HH:MM. Jadwal berlaku sejak ${pending.startDate}.`,
      );
      return true;
    }
    pending.stage = "CUSTOM_MODE";
    await replyToConversation(message, "Pilih mode custom:\n1. Interval (mis. setiap 3 hari)\n2. Tanggal khusus");
    return true;
  }

  if (pending.stage === "CUSTOM_MODE") {
    if (["1", "interval"].includes(normalized)) {
      pending.customMode = "INTERVAL";
      pending.stage = "START";
      await replyToConversation(message, "Masukkan tanggal mulai dan jam. Format: YYYY-MM-DD HH:MM");
      return true;
    }
    if (["2", "tanggal", "tanggal khusus"].includes(normalized)) {
      pending.customMode = "DATES";
      pending.stage = "CUSTOM_DATES";
      await replyToConversation(message, "Masukkan tanggal dan jam khusus, pisahkan dengan koma. Contoh: 2026-09-10 08:00, 2026-09-24 08:00");
      return true;
    }
    await replyToConversation(message, "Pilih 1/Interval atau 2/Tanggal khusus.");
    return true;
  }

  if (pending.stage === "START") {
    const start = parseScheduleStart(value);
    if (!start) {
      await replyToConversation(message, "Format belum benar. Gunakan YYYY-MM-DD HH:MM, misalnya 2026-09-07 06:00.");
      return true;
    }
    pending.startDate = start.date;
    pending.startTime = start.time;
    pending.stage = "CUSTOM_INTERVAL";
    await replyToConversation(message, "Masukkan interval custom. Contoh: 3 hari, 2 minggu, atau 1 bulan.");
    return true;
  }

  if (pending.stage === "TIME") {
    const time = parseScheduleTime(value);
    if (!time) {
      await replyToConversation(message, "Format jam belum benar. Gunakan HH:MM, misalnya 06:00.");
      return true;
    }
    pending.startTime = time;
    if (pending.type === "DAILY") {
      pending.stage = "ROSTER_MODE";
      await replyToConversation(message, "Pola petugas harian:\n1. Petugas sama setiap hari\n2. Petugas berbeda berdasarkan hari dalam minggu");
    } else if (pending.type === "WEEKLY") {
      pending.stage = "WEEKLY_DAYS";
      await replyToConversation(message, "Jadwal mingguan dilakukan setiap hari apa? Masukkan nama hari, misalnya Minggu atau Selasa, Jumat.");
    } else {
      pending.stage = "MONTHLY_DAYS";
      await replyToConversation(message, "Berulang setiap berapa bulan dan tanggal berapa? Format: <angka> | 1,15. Contoh: 1 | 1");
    }
    return true;
  }

  if (pending.stage === "WEEKLY_DAYS") {
    const days = parseScheduleWeekdays(value);
    if (!days) {
      await replyToConversation(message, "Hari belum benar. Contoh: Minggu atau Selasa, Jumat.");
      return true;
    }
    pending.intervalValue = 1;
    pending.weeklyDays = days;
    pending.stage = "MEMBERS";
    await replyToConversation(message, "Masukkan username/nomor WhatsApp petugas, pisahkan dengan koma.");
    return true;
  }

  if (pending.stage === "MONTHLY_DAYS") {
    const [intervalText, daysText] = value.split("|").map((part) => part.trim());
    const interval = Number(intervalText);
    const days = daysText ? parseMonthlyScheduleDays(daysText) : null;
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366 || !days) {
      await replyToConversation(message, "Format belum benar. Contoh: 1 | 1 atau 2 | 1,15.");
      return true;
    }
    pending.intervalValue = interval;
    pending.monthlyDays = days;
    pending.stage = "MEMBERS";
    await replyToConversation(message, "Masukkan username/nomor WhatsApp petugas, pisahkan dengan koma.");
    return true;
  }

  if (pending.stage === "CUSTOM_INTERVAL") {
    const match = value.match(/^(\d+)\s*(hari|minggu|bulan)$/i);
    const units: Record<string, CustomIntervalUnit> = { hari: "DAYS", minggu: "WEEKS", bulan: "MONTHS" };
    const interval = match ? Number(match[1]) : Number.NaN;
    const unit = match ? units[match[2].toLowerCase()] : undefined;
    if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366 || !unit) {
      await replyToConversation(message, "Format belum benar. Contoh: 3 hari, 2 minggu, atau 1 bulan.");
      return true;
    }
    pending.intervalValue = interval;
    pending.customUnit = unit;
    pending.stage = "MEMBERS";
    await replyToConversation(message, "Masukkan username/nomor WhatsApp petugas, pisahkan dengan koma.");
    return true;
  }

  if (pending.stage === "CUSTOM_DATES") {
    const dates = parseCustomScheduleDates(value);
    if (!dates) {
      await replyToConversation(message, "Format belum benar. Contoh: 2026-09-10 08:00, 2026-09-24 08:00");
      return true;
    }
    pending.customDates = dates;
    pending.startDate = dates[0]!.date;
    pending.startTime = dates[0]!.time;
    pending.intervalValue = 1;
    pending.stage = "MEMBERS";
    await replyToConversation(message, "Masukkan username/nomor WhatsApp petugas, pisahkan dengan koma.");
    return true;
  }

  if (pending.stage === "ROSTER_MODE") {
    if (["1", "sama", "sama setiap hari"].includes(normalized)) {
      pending.stage = "MEMBERS";
      await replyToConversation(message, "Masukkan username/nomor WhatsApp petugas, pisahkan dengan koma.");
      return true;
    }
    if (["2", "per hari", "berbeda"].includes(normalized)) {
      pending.stage = "DAILY_ROSTER";
      await replyToConversation(message, "Masukkan petugas per hari, satu baris per hari. Contoh:\nSenin: user1,user2\nSelasa: user3,user4");
      return true;
    }
    await replyToConversation(message, "Pilih 1 untuk petugas sama atau 2 untuk petugas berbeda berdasarkan hari.");
    return true;
  }

  if (pending.stage === "MEMBERS") {
    const identifiers = parseScheduleMemberIdentifiers(value);
    if (!identifiers) {
      await replyToConversation(message, "Masukkan minimal satu username atau nomor WhatsApp.");
      return true;
    }
    pending.memberSpecs = [{ identifiers, weekday: null }];
    return advanceToGroup();
  }

  if (pending.stage === "DAILY_ROSTER") {
    const roster = parseDailyScheduleRoster(value);
    if (!roster) {
      await replyToConversation(message, "Format roster belum benar. Gunakan satu baris per hari, misalnya: Senin: user1,user2");
      return true;
    }
    pending.memberSpecs = roster;
    return advanceToGroup();
  }

  if (pending.stage === "GROUP") {
    pending.groupJid = value === "-" ? null : value;
    pending.stage = "REMINDERS";
    await replyToConversation(message, "Masukkan offset reminder dalam menit, pisahkan dengan koma. Contoh: -30,0 (30 menit sebelum dan saat mulai).");
    return true;
  }

  if (pending.stage === "REMINDERS") {
    const offsets = parseScheduleReminderOffsets(value);
    if (!offsets) {
      await replyToConversation(message, "Offset tidak valid. Contoh: -30,0 atau H-60,H-0.");
      return true;
    }
    pending.reminderOffsetsMinutes = offsets;
    pending.stage = "CONFIRM";
    await replyToConversation(message, scheduleCreationSummary(pending));
    return true;
  }

  if (pending.stage === "CONFIRM") {
    if (normalized !== "ya") {
      await replyToConversation(message, "Balas Ya untuk menyimpan atau Batal untuk membatalkan.");
      return true;
    }
    try {
      const resolvedMembers: CreateActivityScheduleInput["members"] = [];
      for (const specification of pending.memberSpecs ?? []) {
        for (const identifier of specification.identifiers) {
          const user = await findActiveUserByIdentifier(identifier);
          if (!user) throw new Error(`Petugas ${identifier} tidak ditemukan atau tidak aktif.`);
          if (resolvedMembers.some((member) => member.userId === user.id && (member.weekday ?? null) === (specification.weekday ?? null))) {
            continue;
          }
          resolvedMembers.push({ userId: user.id, weekday: specification.weekday ?? null });
        }
      }
      const schedule = await createActivitySchedule({
        name: pending.name!,
        type: pending.type!,
        startDate: pending.startDate!,
        startTime: pending.startTime!,
        intervalValue: pending.intervalValue,
        weeklyDays: pending.weeklyDays,
        monthlyDays: pending.monthlyDays,
        customMode: pending.customMode,
        customUnit: pending.customUnit,
        customDates: pending.customDates,
        members: resolvedMembers,
        groupJid: pending.groupJid,
        reminderOffsetsMinutes: pending.reminderOffsetsMinutes,
        createdBy: pending.actorUserId,
      });
      pendingScheduleCreations.delete(phoneNumber);
      await replyToConversation(message, [
        "*JADWAL BERHASIL DIBUAT*",
        `Kegiatan: ${schedule.name}`,
        `Jenis: ${schedule.type}`,
        `Mulai: ${schedule.startDate} ${schedule.startTime} WIB`,
        `Petugas aktif: ${schedule.members.length}`,
        `Target: ${schedule.groupJid ?? "chat pribadi petugas"}`,
        `Reminder manual: Reminder jadwal ${schedule.name}`,
      ].join("\n"));
    } catch (error) {
      logger.error({ error }, "Pembuatan jadwal gagal.");
      await replyToConversation(message, commandFailureMessage(error, "Jadwal gagal dibuat. Periksa data lalu balas Ya lagi, atau ketik Batal."));
    }
    return true;
  }

  return false;
}

function imageMessageContent(message: WAMessage): {
  mimetype: string;
  fileLength: number;
} | null {
  const image = message.message?.imageMessage;
  if (!image) return null;
  return {
    mimetype: image.mimetype ?? "",
    fileLength: Number(image.fileLength ?? 0),
  };
}

function arrearsTotal(bills: Bill[]): number {
  return bills.reduce((total, bill) => total + bill.sisa, 0);
}

function pendingBillingPaymentSubmittedMessage(
  pending: PendingBillingPayment,
): string {
  if (pending.kind === "CURRENT") {
    if (!pending.nominal) {
      throw new Error("Nominal pembayaran belum diisi.");
    }
    return billingPaymentSubmitted(
      pending.nominal,
      pending.nominal < pending.billSisa,
    );
  }
  if (!pending.nominal || !pending.selectedBills?.length) {
    throw new Error("Nominal atau pilihan tunggakan belum lengkap.");
  }
  return arrearsPaymentSubmitted(
    pending.nominal,
    pending.selectedBills.length,
    pending.nominal < arrearsTotal(pending.selectedBills),
  );
}

async function submitPendingUserBillingPayment(
  pending: PendingBillingPayment,
  channel: PaymentChannel,
  proofStorageKey?: string,
): Promise<Payment> {
  if (pending.kind === "CURRENT") {
    if (!pending.nominal) {
      throw new Error("Nominal pembayaran belum diisi.");
    }
    return submitUserCurrentPayment({
      userId: pending.userId,
      submittedBy: pending.userId,
      billId: pending.billId,
      billingDefinitionId: pending.billingDefinitionId,
      nominal: pending.nominal,
      paymentChannelId: channel.id,
      proofStorageKey,
    });
  }

  if (!pending.selectedBillIds || pending.selectedBillIds.length === 0) {
    throw new Error("Pilih minimal satu tunggakan sebelum mengajukan pembayaran.");
  }
  if (!pending.nominal) {
    throw new Error("Masukkan nominal tunggakan sebelum mengajukan pembayaran.");
  }
  return submitUserArrearsPayment({
    userId: pending.userId,
    submittedBy: pending.userId,
    billingDefinitionId: pending.billingDefinitionId,
    billIds: pending.selectedBillIds,
    nominal: pending.nominal,
    paymentChannelId: channel.id,
    proofStorageKey,
  });
}

function parseArrearsBillPositions(
  text: string,
  billCount: number,
): number[] | null {
  const value = text.trim();
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(value)) {
    return null;
  }
  const positions = value.split(",").map((part) => Number(part.trim()));
  if (
    positions.some(
      (position) =>
        !Number.isSafeInteger(position) || position < 1 || position > billCount,
    ) ||
    new Set(positions).size !== positions.length
  ) {
    return null;
  }
  return positions;
}

async function handlePendingBillingProof(
  message: WAMessage,
  phoneNumber: string,
): Promise<boolean> {
  const pending = pendingBillingPayments.get(phoneNumber);
  const media = imageMessageContent(message);
  if (!pending || !media) {
    return false;
  }

  if (pending.expiresAt < Date.now()) {
    pendingBillingPayments.delete(phoneNumber);
    await socket?.sendMessage(message.key.remoteJid!, {
      text: "Sesi pembayaran sudah kedaluwarsa. Mulai kembali dengan command Bayar.",
    });
    return true;
  }
  if (!pending.selectedChannelId) return false;

  const channel = pending.channels.find(
    (candidate) => candidate.id === pending.selectedChannelId,
  );
  if (!channel || channel.metode === "CASH") return false;

  let proofKey: string | undefined;
  try {
    const file = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: socket!.updateMediaMessage,
      },
    );
    proofKey = await proofStorage.put({
      data: file,
      contentType: media.mimetype,
      name: proofFileName(),
    });
    const payment = await submitPendingUserBillingPayment(
      pending,
      channel,
      proofKey,
    );
    pendingBillingPayments.delete(phoneNumber);
    await socket?.sendMessage(message.key.remoteJid!, {
      text: pendingBillingPaymentSubmittedMessage(pending),
    });
    await sendNextPaymentReviewToPj(payment.routedToAdminId);
  } catch (error) {
    if (proofKey) {
      await proofStorage.delete(proofKey).catch((cleanupError: unknown) => {
        logger.error(
          { error: cleanupError, proofKey },
          "Gagal membersihkan bukti pembayaran di Google Drive.",
        );
      });
    }
    logger.error({ error }, "Pengajuan pembayaran tagihan gagal diteruskan ke PJ.");
    await socket?.sendMessage(message.key.remoteJid!, {
      text: "Pengajuan pembayaran belum dapat diteruskan ke PJ. Silakan coba lagi.",
    });
  }

  return true;
}

async function handlePendingStudentImport(
  message: WAMessage,
  phoneNumber: string,
): Promise<boolean> {
  const pending = pendingStudentImports.get(phoneNumber);
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    pendingStudentImports.delete(phoneNumber);
    return false;
  }
  if (!isExcelDocument(message)) return false;

  const documentSize = Number(
    message.message?.documentMessage?.fileLength ?? 0,
  );
  if (documentSize > maxStudentImportSizeBytes) {
    await socket?.sendMessage(message.key.remoteJid!, {
      text: "File Excel maksimal berukuran 5 MB.",
    });
    return true;
  }

  try {
    const file = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: socket!.updateMediaMessage,
      },
    );
    const result = await importStudentsFromWorkbook(file, pending.actorUserId);
    pendingStudentImports.delete(phoneNumber);
    await socket?.sendMessage(message.key.remoteJid!, {
      text: [
        "*IMPORT DATA SANTRI BERHASIL*",
        `Santri baru: ${result.createdStudents}`,
        `Santri diperbarui: ${result.updatedStudents}`,
      ].join("\n"),
    });
  } catch (error) {
    const reply =
      error instanceof StudentImportValidationError
        ? error.message
        : "Import gagal. Tidak ada data yang disimpan. Periksa konflik username/nomor WhatsApp atau hubungi pengelola sistem.";
    logger.error({ error }, "Import data santri gagal.");
    await socket?.sendMessage(message.key.remoteJid!, { text: reply });
  }

  return true;
}

export async function startWhatsAppBot(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(env.baileysAuthDir);
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu("MIFABOT"),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info(
        "Scan QR berikut dari WhatsApp > Perangkat tertaut untuk menghubungkan MIFABOT.",
      );
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      whatsappConnected = true;
      logger.info("MIFABOT tersambung ke WhatsApp.");
      return;
    }

    if (connection !== "close") {
      return;
    }

    whatsappConnected = false;
    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
      ?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      logger.error(
        "Sesi WhatsApp keluar. Hapus isi BAILEYS_AUTH_DIR lalu jalankan bot untuk pairing ulang.",
      );
      return;
    }

    logger.warn(
      { statusCode },
      "Koneksi WhatsApp terputus; mencoba menyambung kembali.",
    );
    scheduleReconnect();
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const message of messages) {
      if (!isSupportedConversation(message)) {
        continue;
      }

      const phoneNumber = await getSenderPhoneNumber(
        message,
        async (lidJid) =>
          socket
            ? socket.signalRepository.lidMapping.getPNForLID(lidJid)
            : null,
      );
      if (
        phoneNumber &&
        (await handlePendingStudentImport(message, phoneNumber))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingBillingProof(message, phoneNumber))
      ) {
        continue;
      }

      const text = getMessageText(message);
      if (!text) {
        continue;
      }

      if (phoneNumber && isCancelCommand(text)) {
        const cancelledRegistration = pendingSelfRegistrations.delete(phoneNumber);
        const cancelledProfileEdit = pendingProfileEdits.delete(phoneNumber);
        const cancelledPaymentSetup = pendingPaymentChannelSetups.delete(phoneNumber);
        const cancelledPaymentEdit = pendingPaymentChannelEdits.delete(phoneNumber);
        const cancelledPaymentDeactivation = pendingPaymentChannelDeactivations.delete(phoneNumber);
        const cancelledBillingPayment = pendingBillingPayments.delete(phoneNumber);
        const cancelledAdminArrearsPayment = pendingAdminArrearsPayments.delete(phoneNumber);
        const cancelledPaymentReversalList = pendingPaymentReversalLists.delete(phoneNumber);
        const cancelledPaymentReversalConfirmation = pendingPaymentReversalConfirmations.delete(phoneNumber);
        const cancelledScheduleCreation = pendingScheduleCreations.delete(phoneNumber);
        if (
          cancelledRegistration ||
          cancelledProfileEdit ||
          cancelledPaymentSetup ||
          cancelledPaymentEdit ||
          cancelledPaymentDeactivation ||
          cancelledBillingPayment ||
          cancelledAdminArrearsPayment ||
          cancelledPaymentReversalList ||
          cancelledPaymentReversalConfirmation ||
          cancelledScheduleCreation
        ) {
          await replyToConversation(
            message,
            cancelledRegistration
              ? "Pendaftaran dibatalkan."
              : cancelledProfileEdit
                ? "Edit profile dibatalkan."
                : cancelledBillingPayment
                  ? "Pembayaran dibatalkan."
                  : cancelledAdminArrearsPayment
                    ? "Pencatatan pembayaran tunggakan santri dibatalkan."
                    : cancelledPaymentReversalList || cancelledPaymentReversalConfirmation
                      ? "Reversal pembayaran dibatalkan."
                      : cancelledScheduleCreation
                        ? "Pembuatan jadwal dibatalkan."
                        : "Pengaturan metode pembayaran dibatalkan.",
          );
          continue;
        }
      }

      if (
        phoneNumber &&
        (await handlePendingSelfRegistration(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingProfileEdit(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingPaymentChannelSetup(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingPaymentChannelEdit(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingPaymentChannelDeactivation(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingPaymentReversalConfirmation(message, phoneNumber, text))
      ) {
        continue;
      }

      if (
        phoneNumber &&
        (await handlePendingScheduleCreation(message, phoneNumber, text))
      ) {
        continue;
      }

      const command = normalizeSelfCommand(text);

      if (isCreateScheduleCommand(text)) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Buat jadwal hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        const actor = await getActiveUserForWhatsAppNumber(phoneNumber);
        const isScheduleAdmin = isRootAuthorization(phoneNumber)
          || actor?.role === "ADMIN"
          || actor?.role === "SUPER_ADMIN";
        if (!isScheduleAdmin) {
          await replyToConversation(message, "Command Buat jadwal hanya dapat digunakan oleh Admin atau Super Admin.");
          continue;
        }
        pendingScheduleCreations.set(phoneNumber, {
          actorUserId: actor?.id ?? null,
          stage: "NAME",
          expiresAt: Date.now() + selfServiceConversationTimeoutMs,
        });
        await replyToConversation(message, "*BUAT JADWAL*\n\nMasukkan nama kegiatan:");
        continue;
      }

      if (isSelfRegistrationCommand(text)) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Daftar hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }

        try {
          if (await isWhatsAppNumberRegistered(phoneNumber)) {
            await replyToConversation(
              message,
              "Nomor WhatsApp ini sudah terdaftar. Jika akun masih aktif, gunakan Edit profile; bila akun tidak aktif, hubungi pengelola.",
            );
            continue;
          }

          pendingSelfRegistrations.set(phoneNumber, {
            stage: "FULL_NAME",
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await replyToConversation(message, selfRegistrationInstructions());
        } catch (error) {
          logger.error({ error }, "Gagal memeriksa pendaftaran user mandiri.");
          await replyToConversation(
            message,
            "Status pendaftaran gagal diperiksa. Coba lagi nanti.",
          );
        }
        continue;
      }

      if (isEditProfileCommand(text)) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Edit profile hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }

        try {
          const user = await getActiveUserForWhatsAppNumber(phoneNumber);
          if (!user) {
            await replyToConversation(
              message,
              "Edit profile hanya dapat digunakan oleh pengguna aktif MIFABOT.",
            );
            continue;
          }

          pendingProfileEdits.set(phoneNumber, {
            userId: user.id,
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await replyToConversation(message, editProfileInstructions());
        } catch (error) {
          logger.error({ error }, "Gagal memulai edit profile mandiri.");
          await replyToConversation(
            message,
            "Edit profile gagal dimulai. Coba lagi nanti.",
          );
        }
        continue;
      }

      const paymentChannelCommand = parsePaymentChannelCommand(text);
      if (paymentChannelCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command metode pembayaran hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await replyToConversation(message, "Command metode pembayaran hanya dapat digunakan oleh Super Admin.");
          continue;
        }

        try {
          const definition = await findDefinitionByName(paymentChannelCommand.billingName);
          if (!definition) {
            await replyToConversation(message, `Tagihan \"${paymentChannelCommand.billingName}\" tidak ditemukan.`);
            continue;
          }

          if (paymentChannelCommand.action === "LIST") {
            const channels = await getPaymentChannelsForDefinition(definition.id);
            await replyToConversation(message, paymentChannelsMessage(definition.name, channels));
            continue;
          }

          if (paymentChannelCommand.action === "ADD") {
            const owner = await findActiveUserByIdentifier(
              paymentChannelCommand.ownerIdentifier!,
            );
            if (!owner) {
              await replyToConversation(message, "PJ tidak ditemukan atau belum aktif.");
              continue;
            }
            const isResponsible = await isDefinitionResponsible({
              billingDefinitionId: definition.id,
              userId: owner.id,
            });
            if (!isResponsible) {
              await replyToConversation(message, `@${owner.username} bukan PJ aktif untuk tagihan ${definition.name}. Tambahkan dahulu dengan Add PJ ${definition.name} ${owner.username}.`);
              continue;
            }
            pendingPaymentChannelSetups.set(phoneNumber, {
              billingDefinitionId: definition.id,
              billingName: definition.name,
              ownerUserId: owner.id,
              ownerUsername: owner.username,
              stage: "METHOD",
              expiresAt: Date.now() + selfServiceConversationTimeoutMs,
            });
            await replyToConversation(message, paymentChannelMethodInstructions());
            continue;
          }

          const channels = await getPaymentChannelsForDefinition(definition.id);
          const channel = channels[(paymentChannelCommand.position ?? 0) - 1];
          if (!channel) {
            await replyToConversation(message, `Metode nomor ${paymentChannelCommand.position} tidak ditemukan. Gunakan Lihat metode ${definition.name} untuk melihat daftar aktif.`);
            continue;
          }

          if (paymentChannelCommand.action === "EDIT") {
            pendingPaymentChannelEdits.set(phoneNumber, {
              billingDefinitionId: definition.id,
              billingName: definition.name,
              channel,
              expiresAt: Date.now() + selfServiceConversationTimeoutMs,
            });
            await replyToConversation(
              message,
              channel.metode === "CASH"
                ? [
                    `*UBAH METODE: ${channel.nama}*`,
                    "Pilih data yang ingin diubah:",
                    "1. Nama tampilan",
                    "2. Instruksi Cash",
                    "",
                    "Ketik Batal untuk membatalkan.",
                  ].join("\n")
                : [
                    `*UBAH METODE: ${channel.nama}*`,
                    "Pilih data yang ingin diubah:",
                    "1. Nama tampilan",
                    "2. Nomor rekening/E-Wallet",
                    "3. Nama pemilik",
                    "",
                    "Ketik Batal untuk membatalkan.",
                  ].join("\n"),
            );
            continue;
          }

          pendingPaymentChannelDeactivations.set(phoneNumber, {
            billingDefinitionId: definition.id,
            billingName: definition.name,
            channel,
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await replyToConversation(message, [
            `Nonaktifkan metode *${channel.nama}* untuk tagihan ${definition.name}?`,
            "Metode ini tidak lagi dapat dipilih untuk pembayaran baru; histori tetap tersimpan.",
            "Balas Ya untuk melanjutkan atau Tidak untuk membatalkan.",
          ].join("\n"));
        } catch (error) {
          logger.error({ error }, "Pengaturan metode pembayaran gagal diproses.");
          await replyToConversation(message, commandFailureMessage(error, "Pengaturan metode pembayaran gagal diproses. Periksa nama tagihan dan PJ."));
        }
        continue;
      }

      const adminCurrentPaymentCommand = parseAdminCurrentPaymentCommand(text);
      if (adminCurrentPaymentCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Catat bayar hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        if (
          !adminCurrentPaymentCommand.billingName ||
          !adminCurrentPaymentCommand.studentIdentifier ||
          (!adminCurrentPaymentCommand.isFullPayment &&
            (adminCurrentPaymentCommand.nominal === null ||
              !Number.isSafeInteger(adminCurrentPaymentCommand.nominal) ||
              adminCurrentPaymentCommand.nominal <= 0))
        ) {
          await replyToConversation(message, adminCurrentPaymentGuide());
          continue;
        }

        try {
          const [admin, student, definition] = await Promise.all([
            getActiveUserForWhatsAppNumber(phoneNumber),
            findActiveUserByIdentifier(
              adminCurrentPaymentCommand.studentIdentifier,
            ),
            findDefinitionByName(adminCurrentPaymentCommand.billingName),
          ]);
          if (!admin || (admin.role !== "ADMIN" && admin.role !== "SUPER_ADMIN")) {
            await replyToConversation(message, "Command Catat bayar hanya dapat digunakan oleh PJ aktif tagihan.");
            continue;
          }
          if (!student || student.role !== "USER") {
            await replyToConversation(message, "Santri tidak ditemukan atau tidak aktif. Gunakan username atau nomor WhatsApp santri.");
            continue;
          }
          if (!definition || !definition.isActive) {
            await replyToConversation(message, `Tagihan \"${adminCurrentPaymentCommand.billingName}\" tidak tersedia atau tidak aktif.`);
            continue;
          }

          const asOf = currentDateInAppTimezone();
          await ensureCurrentBillsForUser({ userId: student.id, asOf });
          const currentBills = await getCurrentBills({
            userId: student.id,
            billingDefinitionId: definition.id,
            asOf,
          });
          const bill = currentBills[0];
          if (!bill) {
            await replyToConversation(message, `Bill berjalan ${definition.name} milik ${student.namaLengkap} tidak ditemukan atau sudah lunas.`);
            continue;
          }
          const nominal = adminCurrentPaymentCommand.isFullPayment
            ? bill.sisa
            : adminCurrentPaymentCommand.nominal!;
          if (nominal > bill.sisa) {
            await replyToConversation(message, `Nominal melebihi sisa tagihan ${formatRupiah(bill.sisa)}. Tidak ada pembayaran yang dicatat.`);
            continue;
          }

          await submitAdminCurrentPayment({
            userId: student.id,
            submittedBy: admin.id,
            billId: bill.id,
            billingDefinitionId: definition.id,
            nominal,
          });
          await replyToConversation(
            message,
            adminPaymentRecordedMessage({
              studentName: student.namaLengkap,
              billingName: definition.name,
              nominal,
            }),
          );
          try {
            await socket?.sendMessage(`${student.nomorWhatsapp}@s.whatsapp.net`, {
              text: adminPaymentRecordedNotification({
                billingName: definition.name,
                nominal,
              }),
            });
          } catch (notificationError) {
            logger.warn(
              { error: notificationError, userId: student.id },
              "Pembayaran admin tersimpan, tetapi notifikasi santri gagal dikirim.",
            );
          }
        } catch (error) {
          logger.error({ error }, "Pencatatan pembayaran bill berjalan oleh PJ gagal.");
          await replyToConversation(message, "Pembayaran gagal dicatat. Pastikan Anda PJ aktif tagihan dan bill santri masih memiliki sisa.");
        }
        continue;
      }

      const adminArrearsPaymentCommand = parseAdminArrearsPaymentCommand(text);
      if (adminArrearsPaymentCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Catat tunggakan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        if (
          !adminArrearsPaymentCommand.billingName ||
          !adminArrearsPaymentCommand.studentIdentifier
        ) {
          await replyToConversation(message, adminArrearsPaymentGuide());
          continue;
        }

        try {
          const [admin, student, definition] = await Promise.all([
            getActiveUserForWhatsAppNumber(phoneNumber),
            findActiveUserByIdentifier(
              adminArrearsPaymentCommand.studentIdentifier,
            ),
            findDefinitionByName(adminArrearsPaymentCommand.billingName),
          ]);
          if (!admin || (admin.role !== "ADMIN" && admin.role !== "SUPER_ADMIN")) {
            await replyToConversation(message, "Command Catat tunggakan hanya dapat digunakan oleh PJ aktif tagihan.");
            continue;
          }
          if (!student || student.role !== "USER") {
            await replyToConversation(message, "Santri tidak ditemukan atau tidak aktif. Gunakan username atau nomor WhatsApp santri.");
            continue;
          }
          if (!definition || !definition.isActive) {
            await replyToConversation(message, `Tagihan \"${adminArrearsPaymentCommand.billingName}\" tidak tersedia atau tidak aktif.`);
            continue;
          }

          const arrears = await getArrears({
            userId: student.id,
            billingDefinitionId: definition.id,
            asOf: currentDateInAppTimezone(),
          });
          if (arrears.length === 0) {
            await replyToConversation(message, `Tidak ada tunggakan ${definition.name} milik ${student.namaLengkap} yang masih harus dibayar.`);
            continue;
          }

          pendingAdminArrearsPayments.set(phoneNumber, {
            adminUserId: admin.id,
            studentUserId: student.id,
            studentName: student.namaLengkap,
            studentWhatsAppNumber: student.nomorWhatsapp,
            billingDefinitionId: definition.id,
            billingName: definition.name,
            bills: arrears,
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await replyToConversation(
            message,
            adminArrearsBillSelectionMessage(
              student.namaLengkap,
              definition.name,
              arrears,
            ),
          );
        } catch (error) {
          logger.error({ error }, "Gagal memulai pencatatan tunggakan oleh PJ.");
          await replyToConversation(message, "Pencatatan pembayaran tunggakan gagal dimulai. Coba lagi nanti.");
        }
        continue;
      }

      const paymentDecisionCommand = parsePaymentDecisionCommand(text);
      if (paymentDecisionCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command pengajuan pembayaran hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }

        const reviewer = await getActiveUserForWhatsAppNumber(phoneNumber);
        if (
          !reviewer ||
          (reviewer.role !== "ADMIN" && reviewer.role !== "SUPER_ADMIN")
        ) {
          await replyToConversation(message, "Command pengajuan pembayaran hanya dapat digunakan oleh PJ tagihan yang aktif.");
          continue;
        }

        if (paymentDecisionCommand.action === "LIST") {
          try {
            const payments = await getPendingPaymentsForReviewer(reviewer.id);
            let activePayment =
              payments.find((payment) => payment.reviewNotifiedAt !== null) ?? null;
            if (!activePayment && payments.length > 0) {
              activePayment = await claimNextPaymentReviewForReviewer(reviewer.id);
            }
            const waitingCount = activePayment
              ? payments.filter((payment) => payment.id !== activePayment.id).length
              : payments.length;
            await replyToConversation(
              message,
              pendingPaymentReviewsMessage(activePayment, waitingCount),
            );
          } catch (error) {
            logger.error({ error, reviewerId: reviewer.id }, "Gagal mengambil pengajuan pembayaran.");
            await replyToConversation(message, "Daftar pengajuan pembayaran gagal diambil. Coba lagi nanti.");
          }
          continue;
        }

        if (paymentDecisionCommand.reference) {
          await replyToConversation(
            message,
            "Antrean pembayaran sekarang diproses satu per satu. Gunakan Acc, Setujui, Ok, atau Tolak <alasan> untuk pengajuan yang sedang aktif.",
          );
          continue;
        }
        if (
          paymentDecisionCommand.action === "REJECT" &&
          !paymentDecisionCommand.rejectionReason
        ) {
          await replyToConversation(message, "Alasan penolakan wajib diisi. Contoh: Tolak bukti pembayaran tidak jelas");
          continue;
        }

        const payment = await getActivePaymentReviewForReviewer(reviewer.id);
        if (!payment) {
          await replyToConversation(
            message,
            "Tidak ada pengajuan aktif untuk diproses. Ketik List pengajuan untuk melihat antrean.",
          );
          continue;
        }

        const approve = paymentDecisionCommand.action === "APPROVE";
        try {
          await decidePayment({
            paymentId: payment.id,
            verifierId: reviewer.id,
            approve,
            rejectionReason: paymentDecisionCommand.rejectionReason ?? undefined,
          });
          await replyToConversation(
            message,
            paymentDecisionSubmittedMessage(
              payment,
              approve,
              paymentDecisionCommand.rejectionReason ?? undefined,
            ),
          );
          try {
            await socket?.sendMessage(`${payment.payerWhatsAppNumber}@s.whatsapp.net`, {
              text: paymentDecisionNotificationMessage(
                payment,
                approve,
                paymentDecisionCommand.rejectionReason ?? undefined,
              ),
            });
          } catch (notificationError) {
            logger.warn(
              { error: notificationError, paymentId: payment.id },
              "Keputusan pembayaran tersimpan, tetapi notifikasi santri gagal dikirim.",
            );
          }
          await sendNextPaymentReviewToPj(reviewer.id);
        } catch (error) {
          logger.error({ error, paymentId: payment.id }, "Keputusan pembayaran gagal disimpan.");
          await replyToConversation(
            message,
            "Keputusan pembayaran gagal disimpan. Ketik List pengajuan untuk memperbarui antrean lalu coba lagi.",
          );
        }
        continue;
      }

      const billingReportCommand = parseBillingReportCommand(text);
      if (billingReportCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Laporan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        if (!billingReportCommand.billingName) {
          await replyToConversation(message, [
            "Format laporan:",
            "Laporan pembayaran <nama tagihan> [YYYY-MM]",
            "Laporan tunggakan <nama tagihan>",
            "Export pembayaran <nama tagihan> [YYYY-MM]",
            "Export tunggakan <nama tagihan>",
            "Audit pembayaran <nama tagihan>",
          ].join("\n"));
          continue;
        }
        try {
          const [reporter, definition] = await Promise.all([
            getActiveUserForWhatsAppNumber(phoneNumber),
            findDefinitionByName(billingReportCommand.billingName),
          ]);
          if (!reporter || (reporter.role !== "ADMIN" && reporter.role !== "SUPER_ADMIN")) {
            await replyToConversation(message, "Laporan pembayaran hanya dapat digunakan oleh admin atau PJ tagihan.");
            continue;
          }
          if (!definition) {
            await replyToConversation(message, `Tagihan \"${billingReportCommand.billingName}\" tidak ditemukan.`);
            continue;
          }
          if (billingReportCommand.action === "AUDIT") {
            const entries = await getPaymentAuditLog({
              actorUserId: reporter.id,
              billingDefinitionId: definition.id,
            });
            await replyToConversation(message, paymentAuditMessage(entries));
            continue;
          }
          if (billingReportCommand.subject === "PAYMENTS") {
            const report = await getPaymentReport({
              actorUserId: reporter.id,
              billingDefinitionId: definition.id,
              billingName: definition.name,
              period: billingReportCommand.period,
            });
            if (billingReportCommand.action === "REPORT") {
              await replyToConversation(message, paymentReportMessage(report));
            } else {
              await socket?.sendMessage(message.key.remoteJid!, {
                document: await exportPaymentReport(report),
                mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName: `laporan-pembayaran-${definition.code}-${billingReportCommand.period ?? "semua"}.xlsx`,
                caption: paymentReportMessage(report),
              });
            }
          } else {
            const report = await getArrearsReport({
              actorUserId: reporter.id,
              billingDefinitionId: definition.id,
              billingName: definition.name,
              asOf: currentDateInAppTimezone(),
            });
            if (billingReportCommand.action === "REPORT") {
              await replyToConversation(message, arrearsReportMessage(report));
            } else {
              await socket?.sendMessage(message.key.remoteJid!, {
                document: await exportArrearsReport(report),
                mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName: `laporan-tunggakan-${definition.code}-${currentDateInAppTimezone()}.xlsx`,
                caption: arrearsReportMessage(report),
              });
            }
          }
        } catch (error) {
          logger.error({ error }, "Laporan pembayaran gagal diproses.");
          await replyToConversation(message, "Laporan gagal diproses. Pastikan Anda PJ aktif tagihan dan format periode benar.");
        }
        continue;
      }

      const paymentReversalCommand = parsePaymentReversalCommand(text);
      if (paymentReversalCommand) {
        if (!phoneNumber) {
          await replyToConversation(message, "Reversal pembayaran hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        const reviewer = await getActiveUserForWhatsAppNumber(phoneNumber);
        if (!reviewer || (reviewer.role !== "ADMIN" && reviewer.role !== "SUPER_ADMIN")) {
          await replyToConversation(message, "Reversal pembayaran hanya dapat digunakan oleh PJ tagihan yang aktif.");
          continue;
        }
        if (paymentReversalCommand.action === "LIST") {
          if (!paymentReversalCommand.billingName) {
            await replyToConversation(message, "Format: Riwayat pembayaran <nama tagihan>");
            continue;
          }
          try {
            const definition = await findDefinitionByName(paymentReversalCommand.billingName);
            if (!definition) {
              await replyToConversation(message, `Tagihan \"${paymentReversalCommand.billingName}\" tidak ditemukan.`);
              continue;
            }
            const payments = await getApprovedPaymentsForReversal(reviewer.id, definition.id);
            if (payments.length > 0) {
              pendingPaymentReversalLists.set(phoneNumber, {
                actorUserId: reviewer.id,
                payments,
                expiresAt: Date.now() + selfServiceConversationTimeoutMs,
              });
            } else {
              pendingPaymentReversalLists.delete(phoneNumber);
            }
            await replyToConversation(message, approvedPaymentsForReversalMessage(payments));
          } catch (error) {
            logger.error({ error, reviewerId: reviewer.id }, "Riwayat pembayaran untuk reversal gagal diambil.");
            await replyToConversation(message, "Riwayat tidak dapat diakses. Pastikan Anda PJ aktif tagihan.");
          }
          continue;
        }

        if (!paymentReversalCommand.reference || !/^\d+$/.test(paymentReversalCommand.reference) || !paymentReversalCommand.reason) {
          await replyToConversation(message, "Format: Reversal <nomor> <alasan>. Ketik Riwayat pembayaran <nama tagihan> lebih dahulu.");
          continue;
        }
        const list = pendingPaymentReversalLists.get(phoneNumber);
        if (!list || list.expiresAt < Date.now() || list.actorUserId !== reviewer.id) {
          pendingPaymentReversalLists.delete(phoneNumber);
          await replyToConversation(message, "Daftar pembayaran sudah kedaluwarsa. Ketik Riwayat pembayaran <nama tagihan> lagi.");
          continue;
        }
        const payment = list.payments[Number(paymentReversalCommand.reference) - 1];
        if (!payment) {
          await replyToConversation(message, "Nomor pembayaran tidak ditemukan. Ketik Riwayat pembayaran untuk memperbarui daftar.");
          continue;
        }
        pendingPaymentReversalConfirmations.set(phoneNumber, {
          actorUserId: reviewer.id,
          payment,
          reason: paymentReversalCommand.reason,
          expiresAt: Date.now() + selfServiceConversationTimeoutMs,
        });
        await replyToConversation(message, paymentReversalConfirmationMessage({
          payment,
          reason: paymentReversalCommand.reason,
        }));
        continue;
      }

      const arrearsPayment = parseArrearsPaymentCommand(text);
      if (arrearsPayment) {
        if (!phoneNumber) {
          await replyToConversation(message, "Command Bayar tunggakan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.");
          continue;
        }
        if (!arrearsPayment.billingName) {
          await replyToConversation(message, arrearsPaymentGuide());
          continue;
        }

        try {
          const [user, definition] = await Promise.all([
            getActiveUserForWhatsAppNumber(phoneNumber),
            findDefinitionByName(arrearsPayment.billingName),
          ]);
          if (!user || user.role !== "USER") {
            await replyToConversation(message, "Pembayaran tunggakan hanya dapat diajukan oleh santri aktif untuk dirinya sendiri.");
            continue;
          }
          if (!definition || !definition.isActive) {
            await replyToConversation(message, `Tagihan \"${arrearsPayment.billingName}\" tidak tersedia atau tidak aktif. Cek nama tagihan pada command Cek tagihan.`);
            continue;
          }

          const [arrears, channels] = await Promise.all([
            getArrears({
              userId: user.id,
              billingDefinitionId: definition.id,
              asOf: currentDateInAppTimezone(),
            }),
            getPaymentChannels(definition.id),
          ]);
          if (arrears.length === 0) {
            await replyToConversation(message, `Tidak ada tunggakan ${definition.name} yang masih harus dibayar.`);
            continue;
          }
          if (channels.length === 0) {
            await replyToConversation(message, `Belum ada channel pembayaran dari PJ tagihan ${definition.name}. Silakan hubungi admin.`);
            continue;
          }

          pendingBillingPayments.set(phoneNumber, {
            kind: "ARREARS",
            userId: user.id,
            billingDefinitionId: definition.id,
            billingName: definition.name,
            bills: arrears,
            channels,
            stage: "SELECT_BILLS",
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await replyToConversation(
            message,
            arrearsBillSelectionMessage(definition.name, arrears),
          );
        } catch (error) {
          logger.error({ error }, "Gagal memulai pembayaran tunggakan.");
          await replyToConversation(message, "Pembayaran tunggakan gagal dimulai. Coba lagi nanti.");
        }
        continue;
      }

      const billingPayment = parseBillingPaymentCommand(text);
      if (billingPayment) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Bayar hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }

        if (!billingPayment.billingName) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentGuide(),
          });
          continue;
        }

        if (billingPayment.nominal !== null && (
          !Number.isSafeInteger(billingPayment.nominal) ||
          billingPayment.nominal <= 0
        )) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentAmountError(billingPayment.billingName),
          });
          continue;
        }

        const [user, definition] = await Promise.all([
          getActiveUserForWhatsAppNumber(phoneNumber),
          findDefinitionByName(billingPayment.billingName),
        ]);
        if (!user) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Nomor WhatsApp ini belum terdaftar sebagai pengguna aktif MIFABOT.",
          });
          continue;
        }
        if (!definition || !definition.isActive) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: `Tagihan \"${billingPayment.billingName}\" tidak tersedia atau tidak aktif. Cek nama tagihan pada command Cek tagihan.`,
          });
          continue;
        }

        const asOf = currentDateInAppTimezone();
        await ensureCurrentBillsForUser({ userId: user.id, asOf });
        const currentBills = await getCurrentBills({
          userId: user.id,
          asOf,
          billingDefinitionId: definition.id,
        });
        const bill = currentBills[0];
        if (!bill) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: `Tagihan ${definition.name} yang masih harus dibayar tidak ditemukan.`,
          });
          continue;
        }

        if (!billingPayment.isFullPayment && billingPayment.nominal === null) {
          pendingBillingPayments.set(phoneNumber, {
            kind: "CURRENT",
            stage: "ENTER_AMOUNT",
            userId: user.id,
            billId: bill.id,
            billingDefinitionId: definition.id,
            billingName: bill.billingName,
            billSisa: bill.sisa,
            channels: [],
            expiresAt: Date.now() + selfServiceConversationTimeoutMs,
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentAmountPrompt({
              billingName: bill.billingName,
              outstanding: bill.sisa,
            }),
          });
          continue;
        }

        const nominal = billingPayment.isFullPayment
          ? bill.sisa
          : billingPayment.nominal!;
        if (nominal > bill.sisa) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: `Nominal melebihi sisa tagihan ${formatRupiah(bill.sisa)}. Silakan masukkan nominal yang benar.`,
          });
          continue;
        }

        const channels = await getPaymentChannels(definition.id);
        if (channels.length === 0) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: `Belum ada channel pembayaran dari PJ tagihan ${definition.name}. Silakan hubungi admin.`,
          });
          continue;
        }

        pendingBillingPayments.set(phoneNumber, {
          kind: "CURRENT",
          stage: "SELECT_CHANNEL",
          userId: user.id,
          billId: bill.id,
          billingDefinitionId: definition.id,
          billingName: bill.billingName,
          billSisa: bill.sisa,
          nominal,
          channels,
          expiresAt: Date.now() + selfServiceConversationTimeoutMs,
        });
        await socket?.sendMessage(message.key.remoteJid!, {
          text: billingPaymentChannelChoice(
            bill,
            nominal,
            channels,
          ),
        });
        continue;
      }

      const pendingAdminArrearsPayment = phoneNumber
        ? pendingAdminArrearsPayments.get(phoneNumber)
        : undefined;
      if (
        pendingAdminArrearsPayment &&
        pendingAdminArrearsPayment.expiresAt < Date.now()
      ) {
        pendingAdminArrearsPayments.delete(phoneNumber!);
        await replyToConversation(
          message,
          "Sesi pencatatan tunggakan santri sudah kedaluwarsa. Mulai kembali dengan Catat tunggakan.",
        );
        continue;
      }
      if (pendingAdminArrearsPayment) {
        const positions = parseArrearsBillPositions(
          text,
          pendingAdminArrearsPayment.bills.length,
        );
        if (!positions) {
          await replyToConversation(
            message,
            "Pilihan tunggakan tidak valid. Balas nomor yang ditampilkan, misalnya: 1, 3",
          );
          continue;
        }
        const bills = positions.map(
          (position) => pendingAdminArrearsPayment.bills[position - 1]!,
        );
        try {
          await submitAdminArrearsPayment({
            userId: pendingAdminArrearsPayment.studentUserId,
            submittedBy: pendingAdminArrearsPayment.adminUserId,
            billingDefinitionId: pendingAdminArrearsPayment.billingDefinitionId,
            billIds: bills.map((bill) => bill.id),
          });
          pendingAdminArrearsPayments.delete(phoneNumber!);
          const nominal = arrearsTotal(bills);
          await replyToConversation(
            message,
            adminPaymentRecordedMessage({
              studentName: pendingAdminArrearsPayment.studentName,
              billingName: pendingAdminArrearsPayment.billingName,
              nominal,
              arrearsBillCount: bills.length,
            }),
          );
          try {
            await socket?.sendMessage(
              `${pendingAdminArrearsPayment.studentWhatsAppNumber}@s.whatsapp.net`,
              {
                text: adminPaymentRecordedNotification({
                  billingName: pendingAdminArrearsPayment.billingName,
                  nominal,
                  arrearsBillCount: bills.length,
                }),
              },
            );
          } catch (notificationError) {
            logger.warn(
              {
                error: notificationError,
                userId: pendingAdminArrearsPayment.studentUserId,
              },
              "Pembayaran tunggakan oleh PJ tersimpan, tetapi notifikasi santri gagal dikirim.",
            );
          }
        } catch (error) {
          logger.error({ error }, "Pencatatan tunggakan oleh PJ gagal disimpan.");
          pendingAdminArrearsPayments.delete(phoneNumber!);
          await replyToConversation(
            message,
            "Pencatatan tunggakan gagal disimpan karena data tagihan telah berubah atau Anda bukan PJ aktif. Mulai kembali dengan Catat tunggakan.",
          );
        }
        continue;
      }

      const pendingBillingPayment = phoneNumber
        ? pendingBillingPayments.get(phoneNumber)
        : undefined;
      if (pendingBillingPayment && pendingBillingPayment.expiresAt < Date.now()) {
        pendingBillingPayments.delete(phoneNumber!);
        await socket?.sendMessage(message.key.remoteJid!, {
          text: "Sesi pembayaran sudah kedaluwarsa. Mulai kembali dengan command Bayar.",
        });
        continue;
      }

      if (
        pendingBillingPayment?.kind === "CURRENT" &&
        pendingBillingPayment.stage === "ENTER_AMOUNT"
      ) {
        const isFullPayment = normalizeSelfCommand(text) === "lunas";
        const requestedNominal = isFullPayment
          ? pendingBillingPayment.billSisa
          : parseRupiahAmount(text);
        if (!Number.isSafeInteger(requestedNominal) || requestedNominal <= 0) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentAmountError(pendingBillingPayment.billingName),
          });
          continue;
        }

        try {
          const currentBills = await getCurrentBills({
            userId: pendingBillingPayment.userId,
            asOf: currentDateInAppTimezone(),
            billingDefinitionId: pendingBillingPayment.billingDefinitionId,
          });
          const bill = currentBills.find(
            (candidate) => candidate.id === pendingBillingPayment.billId,
          );
          if (!bill) {
            pendingBillingPayments.delete(phoneNumber!);
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan ${pendingBillingPayment.billingName} sudah berubah atau telah lunas. Ketik Bayar ${pendingBillingPayment.billingName} untuk memulai kembali.`,
            });
            continue;
          }
          const nominal = isFullPayment ? bill.sisa : requestedNominal;
          if (nominal > bill.sisa) {
            pendingBillingPayment.billSisa = bill.sisa;
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Nominal melebihi sisa tagihan ${formatRupiah(bill.sisa)}. Masukkan nominal yang benar.`,
            });
            continue;
          }

          const channels = await getPaymentChannels(
            pendingBillingPayment.billingDefinitionId,
          );
          if (channels.length === 0) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Belum ada channel pembayaran dari PJ tagihan ${pendingBillingPayment.billingName}. Silakan hubungi admin.`,
            });
            continue;
          }

          pendingBillingPayment.billSisa = bill.sisa;
          pendingBillingPayment.nominal = nominal;
          pendingBillingPayment.channels = channels;
          pendingBillingPayment.stage = "SELECT_CHANNEL";
          pendingBillingPayment.expiresAt = Date.now() + selfServiceConversationTimeoutMs;
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentChannelChoice(bill, nominal, channels),
          });
        } catch (error) {
          logger.error({ error }, "Gagal memproses nominal pembayaran tagihan.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Nominal pembayaran gagal diproses. Silakan coba lagi.",
          });
        }
        continue;
      }

      if (
        pendingBillingPayment?.kind === "ARREARS" &&
        pendingBillingPayment.stage === "SELECT_BILLS"
      ) {
        const positions = parseArrearsBillPositions(
          text,
          pendingBillingPayment.bills.length,
        );
        if (!positions) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Pilihan tunggakan tidak valid. Balas nomor yang ditampilkan, misalnya: 1, 3",
          });
          continue;
        }
        const bills = positions.map(
          (position) => pendingBillingPayment.bills[position - 1]!,
        );
        pendingBillingPayment.selectedBillIds = bills.map((bill) => bill.id);
        pendingBillingPayment.selectedBills = bills;
        pendingBillingPayment.stage = "ENTER_AMOUNT";
        pendingBillingPayment.expiresAt = Date.now() + selfServiceConversationTimeoutMs;
        await socket?.sendMessage(message.key.remoteJid!, {
          text: arrearsPaymentAmountPrompt(
            pendingBillingPayment.billingName,
            bills,
          ),
        });
        continue;
      }

      if (
        pendingBillingPayment?.kind === "ARREARS" &&
        pendingBillingPayment.stage === "ENTER_AMOUNT"
      ) {
        const isFullPayment = normalizeSelfCommand(text) === "lunas";
        const requestedNominal = isFullPayment
          ? arrearsTotal(pendingBillingPayment.selectedBills ?? [])
          : parseRupiahAmount(text);
        if (!Number.isSafeInteger(requestedNominal) || requestedNominal <= 0) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Nominal tunggakan tidak valid. Balas angka seperti 65000, 65.000, atau 65k; ketik Lunas untuk melunasi pilihan.",
          });
          continue;
        }

        try {
          const currentArrears = await getArrears({
            userId: pendingBillingPayment.userId,
            billingDefinitionId: pendingBillingPayment.billingDefinitionId,
            asOf: currentDateInAppTimezone(),
          });
          const selectedIds = new Set(pendingBillingPayment.selectedBillIds);
          const selectedBills = currentArrears.filter((bill) => selectedIds.has(bill.id));
          if (
            selectedBills.length !== pendingBillingPayment.selectedBillIds?.length
          ) {
            pendingBillingPayments.delete(phoneNumber!);
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "Tunggakan yang dipilih sudah berubah atau telah lunas. Ketik Bayar tunggakan untuk memulai kembali.",
            });
            continue;
          }

          const selectedTotal = arrearsTotal(selectedBills);
          const nominal = isFullPayment ? selectedTotal : requestedNominal;
          if (nominal > selectedTotal) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Nominal melebihi total tunggakan yang dipilih (${formatRupiah(selectedTotal)}). Masukkan nominal yang benar.`,
            });
            continue;
          }

          pendingBillingPayment.selectedBills = selectedBills;
          pendingBillingPayment.nominal = nominal;
          pendingBillingPayment.stage = "SELECT_CHANNEL";
          pendingBillingPayment.expiresAt = Date.now() + selfServiceConversationTimeoutMs;
          await socket?.sendMessage(message.key.remoteJid!, {
            text: arrearsPaymentChannelChoice(
              pendingBillingPayment.billingName,
              selectedBills,
              nominal,
              pendingBillingPayment.channels,
            ),
          });
        } catch (error) {
          logger.error({ error }, "Gagal memproses nominal pembayaran tunggakan.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Nominal tunggakan gagal diproses. Silakan coba lagi.",
          });
        }
        continue;
      }

      if (
        pendingBillingPayment &&
        pendingBillingPayment.stage === "SELECT_CHANNEL" &&
        /^\d+$/.test(text.trim())
      ) {
        const channel = pendingBillingPayment.channels[Number(text.trim()) - 1];
        if (!channel) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Pilihan channel tidak tersedia. Balas dengan nomor channel yang ditampilkan.",
          });
          continue;
        }

        if (channel.metode !== "CASH") {
          pendingBillingPayment.selectedChannelId = channel.id;
          pendingBillingPayment.expiresAt = Date.now() + selfServiceConversationTimeoutMs;
          await socket?.sendMessage(message.key.remoteJid!, {
            text: billingPaymentProofRequest(channel),
          });
          continue;
        }

        try {
          const payment = await submitPendingUserBillingPayment(
            pendingBillingPayment,
            channel,
          );
          pendingBillingPayments.delete(phoneNumber!);
          await socket?.sendMessage(message.key.remoteJid!, {
            text: pendingBillingPaymentSubmittedMessage(pendingBillingPayment),
          });
          await sendNextPaymentReviewToPj(payment.routedToAdminId);
        } catch (error) {
          logger.error({ error }, "Pengajuan pembayaran tagihan gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Pengajuan pembayaran gagal diproses. Silakan periksa tagihan, tunggakan, dan channel pembayaran.",
          });
        }
        continue;
      }

      if (command === "ping") {
        await socket?.sendMessage(message.key.remoteJid!, {
          text: "Pong. MIFABOT aktif.",
        });
        continue;
      }

      if (command === "idgrup") {
        const groupId = getGroupId(message);
        await socket?.sendMessage(message.key.remoteJid!, {
          text: groupId
            ? ["*ID GRUP*", "", groupId].join("\n")
            : "Command Idgrup hanya dapat digunakan di grup WhatsApp.",
        });
        continue;
      }

      if (isHelpCommand(text)) {
        const reply = phoneNumber
          ? await getHelpForWhatsAppNumber(phoneNumber)
          : "Panduan Mifabot hanya dapat digunakan melalui chat pribadi dengan Mifabot.";

        await socket?.sendMessage(message.key.remoteJid!, { text: reply });
        continue;
      }

      if (isListStudentsCommand(text)) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command List santri hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }

        const requester = isRootAuthorization(phoneNumber)
          ? { role: "SUPER_ADMIN" as const }
          : await getActiveUserForWhatsAppNumber(phoneNumber);

        if (
          !requester ||
          (requester.role !== "ADMIN" && requester.role !== "SUPER_ADMIN")
        ) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command List santri hanya dapat digunakan oleh Admin atau Super Admin.",
          });
          continue;
        }

        try {
          const students = await listActiveStudents();
          await socket?.sendMessage(message.key.remoteJid!, {
            text: buildStudentListMessage(students),
          });
        } catch (error) {
          logger.error({ error }, "Gagal mengambil daftar santri.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Daftar santri gagal diambil. Coba lagi nanti.",
          });
        }
        continue;
      }

      if (command === "cek profil" || command === "cek tagihan") {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }

        const user = await getActiveUserForWhatsAppNumber(phoneNumber);
        if (!user) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Nomor WhatsApp ini belum terdaftar sebagai pengguna aktif MIFABOT.",
          });
          continue;
        }

        if (command === "cek profil") {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: buildProfileMessage(user),
          });
          continue;
        }

        try {
          const asOf = currentDateInAppTimezone();
          await ensureCurrentBillsForUser({ userId: user.id, asOf });
          const [currentBills, arrears] = await Promise.all([
            getCurrentBills({ userId: user.id, asOf }),
            getArrears({ userId: user.id, asOf }),
          ]);
          await socket?.sendMessage(message.key.remoteJid!, {
            text: buildBillsMessage(user, currentBills, arrears),
          });
        } catch (error) {
          logger.error({ error, userId: user.id }, "Cek tagihan gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Tagihan belum dapat ditampilkan karena konfigurasi tagihan bermasalah. Silakan hubungi admin MIFABOT.",
          });
        }
        continue;
      }

      const setBillingReminderCommand = parseSetBillingReminderCommand(text);
      const isSetBillingReminderAttempt = /^set\s+reminder(?:\s|$)/i.test(
        command,
      );
      if (setBillingReminderCommand || isSetBillingReminderAttempt) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Set reminder hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Set reminder hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }
        if (!setBillingReminderCommand) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "Format reminder otomatis:",
              "Set reminder <nama tagihan> H-7 H-3 H-0",
              "Set reminder <nama tagihan> off",
            ].join("\n"),
          });
          continue;
        }

        try {
          const [definition, actor] = await Promise.all([
            findDefinitionByName(setBillingReminderCommand.billingName),
            getActiveUserForWhatsAppNumber(phoneNumber),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${setBillingReminderCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }

          await setBillingReminderRules({
            billingDefinitionId: definition.id,
            offsets: setBillingReminderCommand.offsets,
            configuredBy: actor?.id ?? null,
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: setBillingReminderCommand.disabled
              ? [
                  "*REMINDER OTOMATIS DINONAKTIFKAN*",
                  `Tagihan: ${definition.name}`,
                  "Tidak ada reminder otomatis yang akan dikirim untuk bill baru maupun yang masih berjalan.",
                ].join("\n")
              : [
                  "*REMINDER OTOMATIS DIATUR*",
                  `Tagihan: ${definition.name}`,
                  `Jadwal: ${setBillingReminderCommand.offsets.map(formatReminderOffset).join(", ")}`,
                  "Reminder hanya dikirim untuk bill yang masih memiliki sisa tagihan.",
                ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Pengaturan reminder otomatis gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Pengaturan reminder gagal diproses. Periksa tagihan dan format offset H-7, H-0, atau H+3.",
            ),
          });
        }
        continue;
      }

      const configureManualReminderGroupCommand =
        parseConfigureManualReminderGroupCommand(text);
      if (configureManualReminderGroupCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Hubungkan grup reminder hanya dapat digunakan melalui chat pribadi dengan Mifabot.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Hubungkan grup reminder hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }
        if (!configureManualReminderGroupCommand.groupJid) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Format: Hubungkan grup reminder <id grup>. Ambil ID dengan command Idgrup di grup WhatsApp tujuan.",
          });
          continue;
        }

        try {
          const actor = await getActiveUserForWhatsAppNumber(phoneNumber);
          const configuration = await setManualReminderGroup(
            configureManualReminderGroupCommand.groupJid,
            actor?.id ?? null,
          );
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*GRUP REMINDER TERHUBUNG*",
              `ID grup: ${configuration.groupJid}`,
              "Reminder grup berikutnya akan dikirim ke grup ini.",
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Konfigurasi grup reminder gagal disimpan.");
          const feedbackText =
            error instanceof Error &&
            error.message ===
              "ID grup WhatsApp tidak valid. Gunakan ID dari command Idgrup."
              ? error.message
              : "Grup reminder gagal dihubungkan. Pastikan ID grup berasal dari command Idgrup.";
          await socket?.sendMessage(message.key.remoteJid!, { text: feedbackText });
        }
        continue;
      }

      const manualGroupBillingReminderCommand =
        parseManualGroupBillingReminderCommand(text);
      if (manualGroupBillingReminderCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Reminder grup hanya dapat digunakan melalui chat pribadi dengan Mifabot.",
          });
          continue;
        }
        if (!manualGroupBillingReminderCommand.billingName) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Format: Reminder grup <nama tagihan>. Contoh: Reminder grup Syahriah",
          });
          continue;
        }

        try {
          const [definition, requester, configuration] = await Promise.all([
            findDefinitionByName(manualGroupBillingReminderCommand.billingName),
            getActiveUserForWhatsAppNumber(phoneNumber),
            getManualReminderGroup(),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${manualGroupBillingReminderCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }
          const isAuthorized = isRootAuthorization(phoneNumber)
            ? true
            : Boolean(
                requester &&
                  (await isDefinitionResponsible({
                    billingDefinitionId: definition.id,
                    userId: requester.id,
                  })),
              );
          if (!isAuthorized) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "Command Reminder grup hanya dapat digunakan oleh PJ aktif tagihan ini atau Super Admin.",
            });
            continue;
          }
          if (!configuration) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "Grup reminder belum dihubungkan. Super Admin harus menjalankan Hubungkan grup reminder <id grup> terlebih dahulu.",
            });
            continue;
          }

          const report = await getManualGroupBillingReminder(definition.id);
          if (!report) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Belum ada bill ${definition.name} pada periode berjalan untuk dilaporkan ke grup.`,
            });
            continue;
          }

          await socket?.sendMessage(configuration.groupJid, {
            text: buildManualGroupBillingReminderMessage(report),
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*REMINDER GRUP TERKIRIM*",
              `Tagihan: ${report.billingName}`,
              `Akumulasi: ${report.periodStart} s.d. ${report.asOf}`,
              `Target grup: ${configuration.groupJid}`,
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Pengiriman reminder grup gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Reminder grup gagal diproses. Pastikan tagihan aktif, bot masih berada di grup tujuan, lalu coba lagi.",
          });
        }
        continue;
      }

      const manualScheduleReminderCommand = parseManualScheduleReminderCommand(text);
      if (manualScheduleReminderCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Reminder jadwal hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!manualScheduleReminderCommand.scheduleName) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Format: Reminder jadwal <nama kegiatan>. Contoh: Reminder jadwal Piket Kebersihan",
          });
          continue;
        }
        try {
          const requester = await getActiveUserForWhatsAppNumber(phoneNumber);
          const isScheduleAdmin = isRootAuthorization(phoneNumber)
            || requester?.role === "ADMIN"
            || requester?.role === "SUPER_ADMIN";
          if (!isScheduleAdmin) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "Command Reminder jadwal hanya dapat digunakan oleh Admin atau Super Admin.",
            });
            continue;
          }
          const summary = await dispatchManualScheduleReminder({
            scheduleName: manualScheduleReminderCommand.scheduleName,
            requestedBy: requester?.id ?? null,
            sender: {
              sendMessage: sendWhatsAppMessage,
              sendGroupMessage: sendWhatsAppGroupMessage,
            },
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*REMINDER JADWAL DIPROSES*",
              `Kegiatan: ${summary.occurrence.schedule.name}`,
              `Pelaksanaan: ${summary.occurrence.date} ${summary.occurrence.time} WIB`,
              `Target dikirim: ${summary.recipientCount}`,
              `Terkirim: ${summary.sentCount}`,
              `Gagal: ${summary.failedCount}`,
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Pengiriman reminder jadwal manual gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Reminder jadwal gagal diproses. Periksa nama kegiatan dan petugasnya.",
            ),
          });
        }
        continue;
      }

      const manualBillingReminderCommand = parseManualBillingReminderCommand(text);
      if (manualBillingReminderCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Reminder hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!manualBillingReminderCommand.billingName) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Format: Reminder <nama tagihan>. Contoh: Reminder SPP",
          });
          continue;
        }

        try {
          const [definition, requester] = await Promise.all([
            findDefinitionByName(manualBillingReminderCommand.billingName),
            getActiveUserForWhatsAppNumber(phoneNumber),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${manualBillingReminderCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }

          const isAuthorized = isRootAuthorization(phoneNumber)
            ? true
            : Boolean(
                requester &&
                  (await isDefinitionResponsible({
                    billingDefinitionId: definition.id,
                    userId: requester.id,
                  })),
              );
          if (!isAuthorized) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "Command Reminder hanya dapat digunakan oleh PJ aktif tagihan ini atau Super Admin.",
            });
            continue;
          }

          const summary = await dispatchManualBillingReminders({
            billingDefinitionId: definition.id,
            requestedBy: requester?.id ?? null,
            sendMessage: sendWhatsAppMessage,
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text:
              summary.recipientCount === 0
                ? `Tidak ada bill ${definition.name} yang aktif atau menunggak dan belum lunas untuk diingatkan.`
                : [
                    "*REMINDER MANUAL DIPROSES*",
                    `Tagihan: ${definition.name}`,
                    `Terkirim: ${summary.sentCount}`,
                    `Gagal: ${summary.failedCount}`,
                  ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Pengiriman reminder manual gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Reminder manual gagal diproses. Periksa tagihan dan coba lagi.",
            ),
          });
        }
        continue;
      }

      const issueCustomBillingCommand = parseIssueCustomBillingCommand(text);
      if (issueCustomBillingCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Terbitkan tagihan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        try {
          const [definition, actor] = await Promise.all([
            findDefinitionByName(issueCustomBillingCommand.billingName),
            getActiveUserForWhatsAppNumber(phoneNumber),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${issueCustomBillingCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }
          const bills = await generateCustomBillsForPeriod({
            billingDefinitionId: definition.id,
            periodeMulai: issueCustomBillingCommand.periodeMulai,
            periodeSelesai: issueCustomBillingCommand.periodeSelesai,
            jatuhTempo: issueCustomBillingCommand.jatuhTempo,
            dibuatOleh: actor?.id ?? null,
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*TAGIHAN CUSTOM DITERBITKAN*",
              `Tagihan: ${definition.name}`,
              `Periode: ${issueCustomBillingCommand.periodeMulai} s.d. ${issueCustomBillingCommand.periodeSelesai}`,
              `Jatuh tempo: ${issueCustomBillingCommand.jatuhTempo}`,
              `Santri diproses: ${bills.length}`,
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Penerbitan tagihan custom gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Tagihan custom gagal diterbitkan. Periksa nama tagihan dan tanggal periodenya.",
            ),
          });
        }
        continue;
      }

      if (isListBillingDefinitionsCommand(text)) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Daftar Tagihan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        try {
          const definitions = await listDefinitionsForAdmin(
            currentDateInAppTimezone(),
          );
          await socket?.sendMessage(message.key.remoteJid!, {
            text: buildBillingDefinitionListMessage(definitions),
          });
        } catch (error) {
          logger.error({ error }, "Gagal memuat daftar tagihan.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Daftar tagihan gagal dimuat. Silakan coba lagi.",
          });
        }
        continue;
      }

      const deleteBillingCommand = parseDeleteBillingDefinitionCommand(text);
      if (deleteBillingCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Hapus tagihan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        try {
          const definition = await findDefinitionByName(
            deleteBillingCommand.billingName,
          );
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${deleteBillingCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }

          const deactivated = await deactivateDefinition(definition.id);
          await socket?.sendMessage(message.key.remoteJid!, {
            text: deactivated
              ? [
                  "*TAGIHAN DIHAPUS*",
                  `Nama: ${definition.name}`,
                  "Status: Nonaktif. Tagihan baru tidak akan diterbitkan.",
                  "Riwayat tagihan dan pembayaran tetap tersimpan.",
                ].join("\n")
              : `Tagihan \"${definition.name}\" sudah nonaktif.`,
          });
        } catch (error) {
          logger.error({ error }, "Gagal menghapus definisi tagihan.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Tagihan gagal dihapus. Silakan coba lagi.",
            ),
          });
        }
        continue;
      }

      const createBillingCommand = parseCreateBillingDefinitionCommand(text);
      if (createBillingCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Buat tagihan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        try {
          const actor = await getActiveUserForWhatsAppNumber(phoneNumber);
          const definition = await createBillingDefinition({
            name: createBillingCommand.name,
            nominal: createBillingCommand.nominal,
            interval: createBillingCommand.interval,
            createdBy: actor?.id ?? null,
            effectiveDate: currentDateInAppTimezone(),
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*TAGIHAN BERHASIL DIBUAT*",
              `Nama: ${definition.name}`,
              `Nominal default: ${formatRupiah(createBillingCommand.nominal)}`,
              `Interval: ${formatBillingInterval(definition.interval)}`,
              "Status: Menunggu penanggung jawab (belum aktif).",
              "",
              "Tambahkan penanggung jawab dengan:",
              `Add PJ ${definition.name} <username/nomor_whatsapp>`,
              "Tagihan aktif otomatis setelah PJ pertama ditambahkan.",
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Pembuatan definisi tagihan gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Tagihan gagal dibuat. Periksa nama, nominal, dan intervalnya.",
            ),
          });
        }
        continue;
      }

      const responsibleCommand = parseBillingResponsibleCommand(text);
      if (responsibleCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command penanggung jawab tagihan hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        try {
          const [definition, target] = await Promise.all([
            findDefinitionByName(responsibleCommand.billingName),
            findActiveUserByIdentifier(responsibleCommand.identifier),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${responsibleCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }
          if (!target) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: "User tidak ditemukan atau belum aktif. Gunakan username atau nomor WhatsApp yang terdaftar.",
            });
            continue;
          }

          if (responsibleCommand.action === "ADD") {
            await addDefinitionResponsible({
              billingDefinitionId: definition.id,
              userId: target.id,
              asOf: currentDateInAppTimezone(),
            });
            await socket?.sendMessage(message.key.remoteJid!, {
              text: [
                "*PENANGGUNG JAWAB DITAMBAHKAN*",
                `Tagihan: ${definition.name}`,
                `User: @${target.username}`,
                "Role user telah disetel menjadi ADMIN bila sebelumnya masih USER.",
              ].join("\n"),
            });
          } else {
            await removeDefinitionResponsible({
              billingDefinitionId: definition.id,
              userId: target.id,
            });
            await socket?.sendMessage(message.key.remoteJid!, {
              text: [
                "*PENANGGUNG JAWAB DIHAPUS*",
                `Tagihan: ${definition.name}`,
                `User: @${target.username}`,
                "Role user tidak diubah.",
              ].join("\n"),
            });
          }
        } catch (error) {
          logger.error(
            { error, action: responsibleCommand.action },
            "Perubahan penanggung jawab tagihan gagal.",
          );
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Perubahan penanggung jawab gagal diproses. Periksa tagihan dan user tujuan.",
            ),
          });
        }
        continue;
      }

      const setBillingNominalCommand = parseSetBillingNominalCommand(text);
      if (setBillingNominalCommand) {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Set nominal hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }
        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command ini hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }
        if (setBillingNominalCommand.targets.length === 0) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "Format target nominal belum lengkap.",
              "Contoh untuk semua santri:",
              "Set nominal SPP 100000",
              "Semua",
              "",
              "Atau tulis satu username/nomor WhatsApp per baris untuk nominal khusus.",
            ].join("\n"),
          });
          continue;
        }
        if (
          !setBillingNominalCommand.allStudents &&
          setBillingNominalCommand.targets.some((target) => /^semua$/i.test(target))
        ) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Target `Semua` harus ditulis sendiri pada satu baris dan tidak boleh digabung dengan user lain.",
          });
          continue;
        }

        try {
          const [definition, actor] = await Promise.all([
            findDefinitionByName(setBillingNominalCommand.billingName),
            getActiveUserForWhatsAppNumber(phoneNumber),
          ]);
          if (!definition) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `Tagihan \"${setBillingNominalCommand.billingName}\" tidak ditemukan.`,
            });
            continue;
          }

          const targets = setBillingNominalCommand.allStudents
            ? []
            : await Promise.all(
                setBillingNominalCommand.targets.map((identifier) =>
                  findActiveUserByIdentifier(identifier),
                ),
              );
          const unknownTargetIndex = targets.findIndex((target) => !target);
          if (unknownTargetIndex >= 0) {
            await socket?.sendMessage(message.key.remoteJid!, {
              text: `User \"${setBillingNominalCommand.targets[unknownTargetIndex]}\" tidak ditemukan atau belum aktif. Tidak ada nominal yang diubah.`,
            });
            continue;
          }

          const userIds = targets.map((target) => target!.id);
          const effectiveDate = await setBillingNominal({
            billingDefinitionId: definition.id,
            nominal: setBillingNominalCommand.nominal,
            userIds,
            asOf: currentDateInAppTimezone(),
            createdBy: actor?.id ?? null,
          });
          await socket?.sendMessage(message.key.remoteJid!, {
            text: [
              "*NOMINAL TAGIHAN DIUBAH*",
              `Tagihan: ${definition.name}`,
              `Nominal baru: ${formatRupiah(setBillingNominalCommand.nominal)}`,
              setBillingNominalCommand.allStudents
                ? "Sasaran: Semua santri aktif (override nominal khusus sebelumnya ditutup)."
                : `Sasaran: ${userIds.length} santri.`,
              `Berlaku mulai: ${effectiveDate}`,
              "Bill yang sudah diterbitkan tidak berubah.",
            ].join("\n"),
          });
        } catch (error) {
          logger.error({ error }, "Perubahan nominal tagihan gagal.");
          await socket?.sendMessage(message.key.remoteJid!, {
            text: commandFailureMessage(
              error,
              "Nominal tagihan gagal diubah. Periksa tagihan, nominal, dan sasaran.",
            ),
          });
        }
        continue;
      }

      if (command === "data santri") {
        if (!phoneNumber) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Data santri hanya dapat digunakan melalui chat pribadi dengan MIFABOT.",
          });
          continue;
        }

        if (!isRootAuthorization(phoneNumber)) {
          await socket?.sendMessage(message.key.remoteJid!, {
            text: "Command Data santri hanya dapat digunakan oleh Super Admin.",
          });
          continue;
        }

        // Keep the optional database user as the domain/audit actor when the
        // root number also happens to be a registered user. A root without a
        // user record is still authorized; the import itself does not assign
        // billing nominal values.
        const user = await getActiveUserForWhatsAppNumber(phoneNumber);
        pendingStudentImports.set(phoneNumber, {
          actorUserId: user?.id ?? null,
          expiresAt: Date.now() + studentImportTimeoutMs,
        });
        await socket?.sendMessage(message.key.remoteJid!, {
          text: studentImportInstructions(),
        });
      }
    }
  });
}

export function isWhatsAppConnected(): boolean {
  return whatsappConnected;
}

export async function sendWhatsAppMessage(
  phoneNumber: string,
  text: string,
): Promise<void> {
  if (!socket || !whatsappConnected) {
    throw new Error("WhatsApp belum tersambung.");
  }

  await socket.sendMessage(`${phoneNumber}@s.whatsapp.net`, { text });
}

export async function sendWhatsAppGroupMessage(
  groupJid: string,
  text: string,
  mentions: string[],
): Promise<void> {
  if (!socket || !whatsappConnected) {
    throw new Error("WhatsApp belum tersambung.");
  }
  await socket.sendMessage(groupJid, { text, mentions });
}

function scheduleReconnect(): void {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void startWhatsAppBot().catch((error: unknown) => {
      logger.error({ error }, "Gagal menyambung kembali ke WhatsApp.");
      scheduleReconnect();
    });
  }, 3_000);
}

export { isListStudentsCommand, normalizeSelfCommand } from "./message.js";
