import type { WAMessage } from "@whiskeysockets/baileys";

export type BillingInterval =
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY"
  | "CUSTOM";

export interface CreateBillingDefinitionCommand {
  name: string;
  nominal: number;
  interval: BillingInterval;
}

export interface DeleteBillingDefinitionCommand {
  billingName: string;
}

export interface BillingResponsibleCommand {
  action: "ADD" | "DELETE";
  billingName: string;
  identifier: string;
}

export interface PaymentChannelCommand {
  action: "ADD" | "LIST" | "EDIT" | "DEACTIVATE";
  billingName: string;
  ownerIdentifier?: string;
  position?: number;
}

export interface SetBillingNominalCommand {
  billingName: string;
  nominal: number;
  targets: string[];
  allStudents: boolean;
}

export interface IssueCustomBillingCommand {
  billingName: string;
  periodeMulai: string;
  periodeSelesai: string;
  jatuhTempo: string;
}

export interface BillingPaymentCommand {
  billingName: string | null;
  nominal: number | null;
  isFullPayment: boolean;
}

export interface ArrearsPaymentCommand {
  billingName: string | null;
}

export interface PaymentDecisionCommand {
  action: "LIST" | "APPROVE" | "REJECT";
  reference: string | null;
  rejectionReason: string | null;
}

export interface AdminCurrentPaymentCommand {
  billingName: string | null;
  studentIdentifier: string | null;
  nominal: number | null;
  isFullPayment: boolean;
}

export interface AdminArrearsPaymentCommand {
  billingName: string | null;
  studentIdentifier: string | null;
}

export interface SetBillingReminderCommand {
  billingName: string;
  offsets: number[];
  disabled: boolean;
}

export interface ManualBillingReminderCommand {
  billingName: string | null;
}

export interface ManualGroupBillingReminderCommand {
  billingName: string | null;
}

export interface ManualScheduleReminderCommand {
  scheduleName: string | null;
}

export interface ConfigureManualReminderGroupCommand {
  groupJid: string | null;
}

export interface BillingReportCommand {
  action: "REPORT" | "EXPORT" | "AUDIT";
  subject: "PAYMENTS" | "ARREARS";
  billingName: string | null;
  period: string | null;
}

export interface PaymentReversalCommand {
  action: "LIST" | "REVERSE";
  billingName: string | null;
  reference: string | null;
  reason: string | null;
}

/** Fields that a user may change through the self-service profile flow. */
export type SelfProfileField =
  | "fullName"
  | "username"
  | "phoneNumber"
  | "gender";

function stripSelfCommandPrefix(text: string): string {
  return text
    .trim()
    .replace(/^(?:[!\\/]|(?:mifabot|bot)(?=\s|:|-)\s*[:\-]?\s*)/i, "")
    .trim();
}

function normalizeCommandArgument(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const quoted = normalized.match(/^(["'])(.*)\1$/);

  return quoted ? quoted[2].trim() : normalized;
}

export function parseRupiahAmount(value: string): number {
  const normalized = value
    .trim()
    .replace(/^rp\s*/i, "")
    .replace(/\s/g, "")
    .toLowerCase();
  const shorthand = normalized.match(/^(\d+)k$/);
  if (shorthand) {
    return Number(shorthand[1]) * 1_000;
  }

  const digits = normalized.replace(/\./g, "");
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN;
}

export function isListStudentsCommand(text: string): boolean {
  const normalized = normalizeSelfCommand(text);
  return /^(?:list|daftar|lihat)\s+santri$/i.test(normalized);
}

/**
 * Matches the self-registration entry point only. `Daftar santri` remains
 * reserved for the administrator's student-list command.
 */
export function isSelfRegistrationCommand(text: string): boolean {
  return normalizeSelfCommand(text) === "daftar";
}

/** Accept both the Indonesian and English spelling used by operators. */
export function isEditProfileCommand(text: string): boolean {
  return /^edit\s+profil(?:e)?$/i.test(normalizeSelfCommand(text));
}

/** A pending self-service conversation can always be left explicitly. */
export function isCancelCommand(text: string): boolean {
  return normalizeSelfCommand(text) === "batal";
}

/**
 * Parses the menu choice in `Edit profile`. Numeric choices are the primary
 * UX, while field labels make the prompt usable without remembering a number.
 */
export function parseSelfProfileFieldChoice(
  text: string,
): SelfProfileField | null {
  const normalized = normalizeSelfCommand(text);
  const choices: Record<string, SelfProfileField> = {
    "1": "fullName",
    nama: "fullName",
    "nama lengkap": "fullName",
    "2": "username",
    username: "username",
    "3": "phoneNumber",
    whatsapp: "phoneNumber",
    "nomor whatsapp": "phoneNumber",
    "nomor wa": "phoneNumber",
    "4": "gender",
    gender: "gender",
    "jenis kelamin": "gender",
  };

  return choices[normalized] ?? null;
}

export function normalizeSelfCommand(text: string): string {
  const withoutPrefix = stripSelfCommandPrefix(text);
  if (!withoutPrefix) {
    return "";
  }

  return withoutPrefix.replace(/\s+/g, " ").toLowerCase();
}

/** Returns true for every supported entry point to the Mifabot guide. */
export function isHelpCommand(text: string): boolean {
  return ["help", "bot", "panduan", "info"].includes(
    normalizeSelfCommand(text),
  );
}

/**
 * Parses: Buat tagihan <nama tagihan> <nominal> <mingguan|bulanan|tahunan|custom>
 *
 * The name may contain spaces and may optionally be wrapped in matching quotes.
 */
export function parseCreateBillingDefinitionCommand(
  text: string,
): CreateBillingDefinitionCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(
    /^buat\s+tagihan\s+(.+?)\s+(?:rp\s*)?([0-9][0-9.]*)\s+(mingguan|bulanan|tahunan|custom)$/i,
  );
  if (!match) return null;

  const name = normalizeCommandArgument(match[1]);
  if (!name) return null;

  const intervals: Record<string, BillingInterval> = {
    mingguan: "WEEKLY",
    bulanan: "MONTHLY",
    tahunan: "YEARLY",
    custom: "CUSTOM",
  };

  return {
    name,
    nominal: parseRupiahAmount(match[2]),
    interval: intervals[match[3].toLowerCase()],
  };
}

/** Parses: Hapus tagihan <nama tagihan>. */
export function parseDeleteBillingDefinitionCommand(
  text: string,
): DeleteBillingDefinitionCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^hapus\s+tagihan\s+(.+)$/i);
  if (!match) return null;

  const billingName = normalizeCommandArgument(match[1]);
  return billingName ? { billingName } : null;
}

/** Returns true only for the Super Admin billing-definition overview command. */
export function isListBillingDefinitionsCommand(text: string): boolean {
  return normalizeSelfCommand(text) === "daftar tagihan";
}

/**
 * Parses: Add PJ <nama tagihan> <username/nomor_whatsapp>
 *      or Del PJ <nama tagihan> <username/nomor_whatsapp>
 */
export function parseBillingResponsibleCommand(
  text: string,
): BillingResponsibleCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^(add|del)\s+pj\s+(.+?)\s+(\S+)$/i);
  if (!match) return null;

  const billingName = normalizeCommandArgument(match[2]);
  const identifier = match[3].trim();
  if (!billingName || !identifier) return null;

  return {
    action: match[1].toLowerCase() === "add" ? "ADD" : "DELETE",
    billingName,
    identifier,
  };
}

/**
 * Parses payment-channel administration commands.  The channel number is
 * deliberately only used to select an item from `Lihat metode`; its display
 * order is fixed by the application (Bank, E-Wallet, Cash).
 */
export function parsePaymentChannelCommand(text: string): PaymentChannelCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const add = command.match(/^tambah\s+metode\s+(.+?)\s+(\S+)$/i);
  if (add) {
    const billingName = normalizeCommandArgument(add[1]);
    return billingName
      ? { action: "ADD", billingName, ownerIdentifier: add[2].trim() }
      : null;
  }

  const list = command.match(/^lihat\s+metode\s+(.+)$/i);
  if (list) {
    const billingName = normalizeCommandArgument(list[1]);
    return billingName ? { action: "LIST", billingName } : null;
  }

  const change = command.match(/^(ubah|nonaktifkan)\s+metode\s+(.+?)\s+(\d+)$/i);
  if (!change) return null;
  const billingName = normalizeCommandArgument(change[2]);
  const position = Number(change[3]);
  if (!billingName || !Number.isSafeInteger(position) || position <= 0) return null;
  return {
    action: change[1].toLowerCase() === "ubah" ? "EDIT" : "DEACTIVATE",
    billingName,
    position,
  };
}

/**
 * Parses the multi-line command:
 *
 * Set nominal <nama tagihan> <nominal baru>
 * <username/nomor_whatsapp>
 * <username/nomor_whatsapp>
 *
 * `Semua` is valid only as the sole target. The adapter is responsible for
 * resolving identifiers into active student IDs.
 */
export function parseSetBillingNominalCommand(
  text: string,
): SetBillingNominalCommand | null {
  const command = stripSelfCommandPrefix(text);
  const lines = command.split(/\r?\n/);
  const header = normalizeCommandArgument(lines[0] ?? "");
  const match = header.match(
    /^set\s+nominal\s+(.+?)\s+(?:rp\s*)?([0-9][0-9.]*)$/i,
  );
  if (!match) return null;

  const billingName = normalizeCommandArgument(match[1]);
  if (!billingName) return null;

  const targets = lines
    .slice(1)
    .map(normalizeCommandArgument)
    .filter((target) => target.length > 0);

  return {
    billingName,
    nominal: parseRupiahAmount(match[2]),
    targets,
    allStudents:
      targets.length === 1 && /^semua$/i.test(targets[0]),
  };
}

/**
 * Parses: Terbitkan tagihan <nama tagihan> <YYYY-MM-DD> <YYYY-MM-DD> <YYYY-MM-DD>
 *
 * This is intentionally a separate command from definition creation: CUSTOM
 * definitions are issued only when an operator explicitly supplies a period
 * and due date.
 */
export function parseIssueCustomBillingCommand(
  text: string,
): IssueCustomBillingCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(
    /^terbitkan\s+tagihan\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/i,
  );
  if (!match) return null;

  const billingName = normalizeCommandArgument(match[1]);
  if (!billingName) return null;
  return {
    billingName,
    periodeMulai: match[2],
    periodeSelesai: match[3],
    jatuhTempo: match[4],
  };
}

/**
 * Parses: Bayar <nama tagihan> <nominal>
 *
 * If the nominal is absent, the billing name is retained so callers can show
 * a helpful format message. A name can contain spaces and optional quotes.
 */
export function parseBillingPaymentCommand(
  text: string,
): BillingPaymentCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^bayar(?:\s+(.+))?$/i);
  if (!match) return null;

  const body = match[1] ? normalizeCommandArgument(match[1]) : "";
  if (!body) {
    return { billingName: null, nominal: null, isFullPayment: false };
  }

  const fullPaymentMatch = body.match(/^(.+?)\s+lunas$/i);
  if (fullPaymentMatch) {
    const billingName = normalizeCommandArgument(fullPaymentMatch[1]);
    return billingName
      ? { billingName, nominal: null, isFullPayment: true }
      : { billingName: null, nominal: null, isFullPayment: false };
  }

  const amountMatch = body.match(
    /^(.+?)\s+(?:rp\s*)?([0-9]+(?:\.[0-9]{3})*|[0-9]+k)$/i,
  );
  if (!amountMatch) {
    return {
      billingName: normalizeCommandArgument(body),
      nominal: null,
      isFullPayment: false,
    };
  }

  const billingName = normalizeCommandArgument(amountMatch[1]);
  return billingName
    ? {
      billingName,
      nominal: parseRupiahAmount(amountMatch[2]),
      isFullPayment: false,
    }
    : { billingName: null, nominal: null, isFullPayment: false };
}

/**
 * Parses: Bayar tunggakan <nama tagihan>
 *
 * Arrears are deliberately selected in a following conversation step.  This
 * prevents an operator or user from having to copy opaque bill IDs into a
 * WhatsApp command and ensures the service can lock and revalidate the bills
 * immediately before the payment is stored.
 */
export function parseArrearsPaymentCommand(
  text: string,
): ArrearsPaymentCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^bayar\s+tunggakan(?:\s+(.+))?$/i);
  if (!match) return null;

  const billingName = match[1]
    ? normalizeCommandArgument(match[1])
    : "";
  return { billingName: billingName || null };
}

/**
 * Parses a PJ's payment-review commands:
 *
 * List pengajuan
 * Setujui
 * Tolak <alasan>
 *
 * Numbered commands remain parseable for older conversations, but the active
 * queue always expects the PJ to decide only the payment currently shown.
 */
export function parsePaymentDecisionCommand(
  text: string,
): PaymentDecisionCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  if (/^(?:list|daftar)\s+pengajuan$/i.test(command)) {
    return { action: "LIST", reference: null, rejectionReason: null };
  }

  const approve = command.match(/^(?:acc|setujui|ok)(?:\s+(\S+))?$/i);
  if (approve) {
    return {
      action: "APPROVE",
      reference: approve[1]?.trim() || null,
      rejectionReason: null,
    };
  }

  const reject = command.match(/^tolak(?:\s+(.+))?$/i);
  if (!reject) return null;
  const body = reject[1] ? normalizeCommandArgument(reject[1]) : "";
  const numbered = body.match(/^(\d+)(?:\s+(.+))?$/);
  return {
    action: "REJECT",
    reference: numbered?.[1] ?? null,
    rejectionReason: numbered
      ? (numbered[2] ? normalizeCommandArgument(numbered[2]) : "") || null
      : body || null,
  };
}

/**
 * Parses reporting commands while keeping a billing name free to contain
 * spaces.  A monthly filter, when present, is always the final YYYY-MM token.
 */
export function parseBillingReportCommand(
  text: string,
): BillingReportCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^(laporan|export)\s+(pembayaran|tunggakan)(?:\s+(.+))?$/i);
  if (match) {
    const body = match[3] ? normalizeCommandArgument(match[3]) : "";
    let billingName = body;
    let period: string | null = null;
    if (/^pembayaran$/i.test(match[2])) {
      const periodMatch = body.match(/^(.+?)\s+(\d{4}-(?:0[1-9]|1[0-2]))$/);
      if (periodMatch) {
        billingName = normalizeCommandArgument(periodMatch[1]);
        period = periodMatch[2];
      }
    }
    return {
      action: /^laporan$/i.test(match[1]) ? "REPORT" : "EXPORT",
      subject: /^pembayaran$/i.test(match[2]) ? "PAYMENTS" : "ARREARS",
      billingName: billingName || null,
      period,
    };
  }

  const audit = command.match(/^audit\s+pembayaran(?:\s+(.+))?$/i);
  if (!audit) return null;
  const billingName = audit[1] ? normalizeCommandArgument(audit[1]) : "";
  return { action: "AUDIT", subject: "PAYMENTS", billingName: billingName || null, period: null };
}

/**
 * The history list issues a short-lived reference.  Reversal itself always
 * requires a reason and a later explicit confirmation in the adapter.
 */
export function parsePaymentReversalCommand(
  text: string,
): PaymentReversalCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const list = command.match(/^riwayat\s+pembayaran(?:\s+(.+))?$/i);
  if (list) {
    const billingName = list[1] ? normalizeCommandArgument(list[1]) : "";
    return { action: "LIST", billingName: billingName || null, reference: null, reason: null };
  }
  const reversal = command.match(/^reversal(?:\s+(\S+))?(?:\s+(.+))?$/i);
  if (!reversal) return null;
  return {
    action: "REVERSE",
    billingName: null,
    reference: reversal[1]?.trim() || null,
    reason: reversal[2] ? normalizeCommandArgument(reversal[2]) || null : null,
  };
}

/**
 * Parses: Catat bayar <nama tagihan> <username/nomor_whatsapp> <nominal|lunas>
 *
 * The final two arguments are deliberately unquoted stable identifiers and a
 * nominal/lunas marker, which leaves the billing name free to contain spaces
 * or quotes. `lunas` resolves to the student's outstanding current balance.
 */
export function parseAdminCurrentPaymentCommand(
  text: string,
): AdminCurrentPaymentCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  if (!/^catat\s+bayar(?:\s|$)/i.test(command)) return null;

  const match = command.match(
    /^catat\s+bayar\s+(.+?)\s+(\S+)\s+(?:rp\s*)?([0-9][0-9.]*|lunas)$/i,
  );
  if (!match) {
    return {
      billingName: null,
      studentIdentifier: null,
      nominal: null,
      isFullPayment: false,
    };
  }

  const billingName = normalizeCommandArgument(match[1]);
  const studentIdentifier = match[2].trim();
  return billingName && studentIdentifier
    ? {
        billingName,
        studentIdentifier,
        nominal: /^lunas$/i.test(match[3]) ? null : parseRupiahAmount(match[3]),
        isFullPayment: /^lunas$/i.test(match[3]),
      }
    : {
        billingName: null,
        studentIdentifier: null,
        nominal: null,
        isFullPayment: false,
      };
}

/**
 * Parses: Catat tunggakan <nama tagihan> <username/nomor_whatsapp>
 *
 * Periods are selected in the following conversation step to keep UUID bill
 * identifiers out of the operator's command.
 */
export function parseAdminArrearsPaymentCommand(
  text: string,
): AdminArrearsPaymentCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  if (!/^catat\s+tunggakan(?:\s|$)/i.test(command)) return null;

  const match = command.match(/^catat\s+tunggakan\s+(.+?)\s+(\S+)$/i);
  if (!match) return { billingName: null, studentIdentifier: null };

  const billingName = normalizeCommandArgument(match[1]);
  const studentIdentifier = match[2].trim();
  return billingName && studentIdentifier
    ? { billingName, studentIdentifier }
    : { billingName: null, studentIdentifier: null };
}

/**
 * Parses: Set reminder <nama tagihan> H-7 H-3 H-0
 *      or Set reminder <nama tagihan> off
 *
 * Reminder offsets are expressed relative to each bill's due date. A
 * negative value is before the due date, zero is on it, and a positive value
 * is after it.
 */
export function parseSetBillingReminderCommand(
  text: string,
): SetBillingReminderCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^set\s+reminder\s+(.+?)\s+(off|(?:h[+-]\d+(?:\s+h[+-]\d+)*))$/i);
  if (!match) return null;

  const billingName = normalizeCommandArgument(match[1]);
  if (!billingName) return null;

  if (/^off$/i.test(match[2])) {
    return {
      billingName,
      offsets: [],
      disabled: true,
    };
  }

  const offsets = match[2]
    .trim()
    .split(/\s+/)
    .map((offset) => Number.parseInt(offset.slice(1), 10));
  if (offsets.some((offset) => !Number.isSafeInteger(offset))) {
    return null;
  }

  return {
    billingName,
    offsets,
    disabled: false,
  };
}

/**
 * Parses: Reminder <nama tagihan>
 *
 * An omitted name is retained so the adapter can reply with the command
 * format instead of silently ignoring an otherwise recognized command.
 */
export function parseManualBillingReminderCommand(
  text: string,
): ManualBillingReminderCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  if (/^reminder\s+(?:grup|jadwal)(?:\s|$)/i.test(command)) return null;
  const match = command.match(/^reminder(?:\s+(.+))?$/i);
  if (!match) return null;

  const billingName = match[1]
    ? normalizeCommandArgument(match[1])
    : "";
  return { billingName: billingName || null };
}

/** Parses: Reminder jadwal <nama kegiatan>. */
export function parseManualScheduleReminderCommand(
  text: string,
): ManualScheduleReminderCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^reminder\s+jadwal(?:\s+(.+))?$/i);
  if (!match) return null;
  const scheduleName = match[1] ? normalizeCommandArgument(match[1]) : "";
  return { scheduleName: scheduleName || null };
}

/** `Buat jadwal` deliberately opens the universal schedule wizard. */
export function isCreateScheduleCommand(text: string): boolean {
  return normalizeSelfCommand(text) === "buat jadwal";
}

/** Parses: Reminder grup <nama tagihan>. */
export function parseManualGroupBillingReminderCommand(
  text: string,
): ManualGroupBillingReminderCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^reminder\s+grup(?:\s+(.+))?$/i);
  if (!match) return null;

  const billingName = match[1]
    ? normalizeCommandArgument(match[1])
    : "";
  return { billingName: billingName || null };
}

/** Parses: Hubungkan grup reminder <id grup>. */
export function parseConfigureManualReminderGroupCommand(
  text: string,
): ConfigureManualReminderGroupCommand | null {
  const command = normalizeCommandArgument(stripSelfCommandPrefix(text));
  const match = command.match(/^hubungkan\s+grup\s+reminder(?:\s+(\S+))?$/i);
  if (!match) return null;
  return { groupJid: match[1]?.trim() || null };
}

export function getMessageText(message: WAMessage): string | null {
  const content = message.message;
  const text = content?.conversation ?? content?.extendedTextMessage?.text;

  return text?.trim() || null;
}

export function isSupportedConversation(message: WAMessage): boolean {
  return Boolean(
    message.key.remoteJid &&
    !message.key.fromMe &&
    message.key.remoteJid !== "status@broadcast",
  );
}

export function getGroupId(message: WAMessage): string | null {
  const remoteJid = message.key.remoteJid;
  return remoteJid?.endsWith("@g.us") ? remoteJid : null;
}

type PhoneJidResolver = (lidJid: string) => Promise<string | null>;

function phoneNumberFromJid(jid: string | null | undefined): string | null {
  if (
    !jid ||
    (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us"))
  ) {
    return null;
  }

  const phoneNumber = jid.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(phoneNumber) ? phoneNumber : null;
}

/**
 * Resolves the sender's WhatsApp phone number for a private message.
 *
 * WhatsApp can address conversations by an opaque LID instead of a phone
 * JID. New messages normally include `remoteJidAlt`, but that field is not
 * guaranteed (for example after history sync). In that case, use Baileys'
 * persisted LID mapping so registered users retain access to their own
 * tagihan and payment flow.
 */
export async function getSenderPhoneNumber(
  message: WAMessage,
  resolvePhoneJidFromLid?: PhoneJidResolver,
): Promise<string | null> {
  const remoteJid = message.key.remoteJid;
  if (!remoteJid || remoteJid.endsWith("@g.us")) {
    return null;
  }

  // Newer WhatsApp sessions may address a private chat with a LID JID
  // (typically ending in @lid). Baileys provides the phone-number JID as
  // remoteJidAlt in that case. Ignore LID values because they are not phone
  // numbers and cannot be compared with SUPER_ADMIN_WHATSAPP.
  const candidates = [message.key.remoteJidAlt, remoteJid];
  for (const jid of candidates) {
    const phoneNumber = phoneNumberFromJid(jid);
    if (phoneNumber) return phoneNumber;
  }

  if (remoteJid.endsWith("@lid") && resolvePhoneJidFromLid) {
    const phoneJid = await resolvePhoneJidFromLid(remoteJid);
    return phoneNumberFromJid(phoneJid);
  }

  return null;
}
