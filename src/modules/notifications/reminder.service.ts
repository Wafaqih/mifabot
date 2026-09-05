import { env } from "../../config/env.js";
import { databasePool, withTransaction } from "../../core/database/pool.js";
import { logger } from "../../core/logger/logger.js";
import {
  claimAutomaticBillingReminderDelivery,
  claimManualBillingReminderDelivery,
  createManualBillingReminderBatch,
  deactivateMissingBillingReminderRules,
  findAutomaticBillingReminderRecipients,
  findManualBillingReminderRecipients,
  getManualGroupBillingReminderReport,
  getManualReminderGroupConfiguration,
  getReminderDefinitionState,
  insertBillingReminderRule,
  listActiveBillingReminderRules,
  markBillingReminderDeliveryFailed,
  markBillingReminderDeliverySent,
  setManualReminderGroupConfiguration,
} from "./reminder.repository.js";
import type {
  BillingReminderRecipient,
  BillingReminderRule,
  DispatchAutomaticBillingRemindersInput,
  DispatchManualBillingRemindersInput,
  ManualGroupBillingReminderReport,
  ManualReminderGroupConfiguration,
  ReminderDispatchSummary,
  SetBillingReminderRulesInput,
} from "./reminder.types.js";

function parseDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Tanggal harus menggunakan format YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Tanggal tidak valid.");
  }
}

function currentDateInAppTimezone(): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: env.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function greetingFor(recipient: BillingReminderRecipient): string {
  return recipient.jenisKelamin === "L" ? "Mang" : "Teh";
}

function paymentInstruction(recipient: BillingReminderRecipient): string {
  return [
    "*Cara pembayaran melalui MIFABOT:*",
    `1. Balas chat ini dengan *Bayar ${recipient.billingName} <nominal>*. Ganti <nominal> dengan jumlah yang ingin dibayar (angka tanpa titik atau koma).`,
    `   Untuk membayar penuh, ketik *Bayar ${recipient.billingName} lunas*.`,
    "2. Pilih metode pembayaran yang tersedia di bot.",
    "3. Ikuti instruksi pembayaran dan kirim bukti jika diminta oleh bot.",
    "4. Tunggu konfirmasi verifikasi pembayaran dari bot.",
  ].join("\n");
}

/** Scheduled reminders use the same wording regardless of the reminder offset. */
export function buildAutomaticBillingReminderMessage(
  recipient: BillingReminderRecipient,
): string {
  return buildManualBillingReminderMessage(recipient);
}

/** Generic message used by a PJ/Super Admin manual dispatch. */
export function buildManualBillingReminderMessage(
  recipient: BillingReminderRecipient,
): string {
  return [
    `Assalamu'alaikum ${greetingFor(recipient)} ${recipient.username},`,
    "",
    `Ini adalah pengingat tagihan ${recipient.billingName} Anda.`,
    `Sisa tagihan: ${formatRupiah(recipient.sisa)}.`,
    "Mohon lakukan pembayaran sebelum tenggat waktu.",
    "Pembayaran dapat dilakukan secara dicicil atau penuh.",
    "",
    paymentInstruction(recipient),
    "",
    "Terima kasih atas perhatian dan kesediaannya menyelesaikan pembayaran.",
  ].join("\n");
}

function formatReportDate(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

/** Validates the WhatsApp JID returned by the `Idgrup` command. */
export function validateManualReminderGroupJid(groupJid: string): string {
  const normalized = groupJid.trim();
  if (!/^[0-9]+(?:-[0-9]+)?@g\.us$/i.test(normalized)) {
    throw new Error("ID grup WhatsApp tidak valid. Gunakan ID dari command Idgrup.");
  }
  return normalized;
}

export async function setManualReminderGroup(
  groupJid: string,
  configuredBy: string | null,
): Promise<ManualReminderGroupConfiguration> {
  const normalizedGroupJid = validateManualReminderGroupJid(groupJid);
  return withTransaction((client) =>
    setManualReminderGroupConfiguration(client, {
      groupJid: normalizedGroupJid,
      configuredBy,
    }),
  );
}

export async function getManualReminderGroup(): Promise<ManualReminderGroupConfiguration | null> {
  return getManualReminderGroupConfiguration(databasePool);
}

/**
 * Builds a privacy-safe aggregate for the period that contains `asOf`.
 * Every approved payment from the beginning of that period until `asOf` is
 * included; this intentionally is not a report of only today's payments.
 */
export async function getManualGroupBillingReminder(
  billingDefinitionId: string,
  asOf = currentDateInAppTimezone(),
): Promise<ManualGroupBillingReminderReport | null> {
  parseDate(asOf);
  return withTransaction(async (client) => {
    const definition = await getReminderDefinitionState(
      client,
      billingDefinitionId,
      true,
    );
    if (!definition?.isActive) {
      throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");
    }
    return getManualGroupBillingReminderReport(client, {
      billingDefinitionId,
      asOf,
    });
  });
}

export function buildManualGroupBillingReminderMessage(
  report: ManualGroupBillingReminderReport,
): string {
  return [
    "Assalamu'alaikum warahmatullahi wabarakatuh amang/teteh...",
    "",
    `*Izin mengingatkan bahwa ada kewajiban kita selaku santri/ah untuk membayar ${report.billingName}.*`,
    "",
    `Laporan ${report.billingName} periode berjalan`,
    formatReportDate(report.asOf),
    `Akumulasi pembayaran: ${formatDate(report.periodStart)} s.d. ${formatDate(report.asOf)}`,
    `Santri yang sudah membayar : ${report.santriPaidCount}/${report.santriTargetCount} (Total ${formatRupiah(report.santriPaidAmount)})`,
    `Santriah yang sudah membayar : ${report.santriahPaidCount}/${report.santriahTargetCount} (Total ${formatRupiah(report.santriahPaidAmount)})`,
    `Total yang sudah bayar : ${report.totalPaidCount}`,
    `Total uang masuk : ${formatRupiah(report.totalPaidAmount)}`,
    `Total yang belum bayar : ${report.totalUnpaidCount} (-${formatRupiah(report.totalOutstandingAmount)})`,
    "",
    "Mohon santri/ah yang masih memiliki kewajiban pembayaran untuk segera menyelesaikannya.",
    `Bayar ${report.billingName} via MIFABOT :`,
    "Kirim pesan ke nomor 62855165924950",
    `Ketik *Bayar ${report.billingName}*`,
    "",
    "Terimakasih atas perhatiannya🙏",
    "Wassalamu'alaikum warahmatullahi wabarakatuh",
    "",
    "───────",
    "ᴍɪꜰᴀʙᴏᴛ",
  ].join("\n");
}

export function validateReminderOffsets(offsets: number[]): void {
  if (
    offsets.some(
      (offset) =>
        !Number.isSafeInteger(offset) || offset < -32_768 || offset > 32_767,
    )
  ) {
    throw new Error("Offset reminder harus berupa jumlah hari antara -32768 dan 32767.");
  }
  if (new Set(offsets).size !== offsets.length) {
    throw new Error("Offset reminder tidak boleh duplikat.");
  }
}

/**
 * Replaces the active H-offsets for a definition.  Inactive historical rules
 * are retained in the database for audit and a newly selected offset receives
 * a new rule identity.
 */
export async function setBillingReminderRules(
  input: SetBillingReminderRulesInput,
): Promise<BillingReminderRule[]> {
  validateReminderOffsets(input.offsets);
  const offsets = [...input.offsets];
  const configuredBy = input.configuredBy ?? null;

  return withTransaction(async (client) => {
    const definition = await getReminderDefinitionState(
      client,
      input.billingDefinitionId,
      true,
    );
    if (!definition) throw new Error("Definisi tagihan tidak ditemukan.");

    const currentRules = await listActiveBillingReminderRules(
      client,
      input.billingDefinitionId,
    );
    const currentOffsets = new Set(
      currentRules.map((rule) => rule.offsetDays),
    );
    await deactivateMissingBillingReminderRules(client, {
      billingDefinitionId: input.billingDefinitionId,
      retainedOffsets: offsets,
      deactivatedBy: configuredBy,
    });

    for (const offsetDays of offsets) {
      if (!currentOffsets.has(offsetDays)) {
        await insertBillingReminderRule(client, {
          billingDefinitionId: input.billingDefinitionId,
          offsetDays,
          configuredBy,
        });
      }
    }

    return listActiveBillingReminderRules(client, input.billingDefinitionId);
  });
}

function errorReason(error: unknown): string {
  const reason = error instanceof Error ? error.message : "Pengiriman gagal.";
  return reason.slice(0, 2_000);
}

async function sendClaimedReminder(
  input: {
    recipient: BillingReminderRecipient;
    deliveryId: string;
    message: string;
    sendMessage: (phoneNumber: string, text: string) => Promise<void>;
  },
): Promise<"SENT" | "FAILED"> {
  try {
    await input.sendMessage(input.recipient.nomorWhatsapp, input.message);
  } catch (error) {
    const reason = errorReason(error);
    try {
      await markBillingReminderDeliveryFailed(databasePool, {
        deliveryId: input.deliveryId,
        reason,
      });
    } catch (markError) {
      logger.error(
        { error: markError, deliveryId: input.deliveryId },
        "Status kegagalan reminder tidak dapat disimpan.",
      );
    }
    logger.error(
      { error, deliveryId: input.deliveryId, userId: input.recipient.userId },
      "Pengiriman reminder gagal.",
    );
    return "FAILED";
  }

  try {
    await markBillingReminderDeliverySent(databasePool, input.deliveryId);
  } catch (error) {
    // The recipient has already received the WhatsApp message; do not turn a
    // successful external delivery into FAILED, which could cause a duplicate.
    logger.error(
      { error, deliveryId: input.deliveryId },
      "Reminder terkirim tetapi status delivery tidak dapat diperbarui.",
    );
  }
  return "SENT";
}

/** Execute all H-offset rules that are scheduled for one local calendar day. */
export async function dispatchAutomaticBillingReminders(
  input: DispatchAutomaticBillingRemindersInput,
): Promise<ReminderDispatchSummary> {
  parseDate(input.asOf);
  const recipients = await findAutomaticBillingReminderRecipients(
    databasePool,
    input.asOf,
  );
  let sentCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    if (!recipient.ruleId) continue;
    const message = buildAutomaticBillingReminderMessage(recipient);
    let deliveryId: string | null;
    try {
      deliveryId = await claimAutomaticBillingReminderDelivery(databasePool, {
        ruleId: recipient.ruleId,
        billId: recipient.billId,
        messageBody: message,
      });
    } catch (error) {
      failedCount += 1;
      logger.error(
        { error, billId: recipient.billId, ruleId: recipient.ruleId },
        "Delivery reminder otomatis tidak dapat diklaim.",
      );
      continue;
    }
    if (!deliveryId) continue;

    const outcome = await sendClaimedReminder({
      recipient,
      deliveryId,
      message,
      sendMessage: input.sendMessage,
    });
    if (outcome === "SENT") sentCount += 1;
    else failedCount += 1;
  }

  return { recipientCount: recipients.length, sentCount, failedCount };
}

/**
 * Create an auditable batch and send every outstanding current/arrears bill
 * for its definition.  A later manual command always creates a new batch.
 */
export async function dispatchManualBillingReminders(
  input: DispatchManualBillingRemindersInput,
): Promise<ReminderDispatchSummary> {
  const asOf = input.asOf ?? currentDateInAppTimezone();
  parseDate(asOf);
  const prepared = await withTransaction(async (client) => {
    const definition = await getReminderDefinitionState(
      client,
      input.billingDefinitionId,
      true,
    );
    if (!definition?.isActive) {
      throw new Error("Definisi tagihan tidak aktif atau tidak ditemukan.");
    }
    const batchId = await createManualBillingReminderBatch(client, {
      billingDefinitionId: input.billingDefinitionId,
      requestedBy: input.requestedBy ?? null,
      asOf,
    });
    const recipients = await findManualBillingReminderRecipients(client, {
      billingDefinitionId: input.billingDefinitionId,
      asOf,
    });
    return { batchId, recipients };
  });

  let sentCount = 0;
  let failedCount = 0;
  for (const recipient of prepared.recipients) {
    const message = buildManualBillingReminderMessage(recipient);
    let deliveryId: string | null;
    try {
      deliveryId = await claimManualBillingReminderDelivery(databasePool, {
        batchId: prepared.batchId,
        billId: recipient.billId,
        messageBody: message,
      });
    } catch (error) {
      failedCount += 1;
      logger.error(
        { error, billId: recipient.billId, batchId: prepared.batchId },
        "Delivery reminder manual tidak dapat diklaim.",
      );
      continue;
    }
    if (!deliveryId) continue;

    const outcome = await sendClaimedReminder({
      recipient,
      deliveryId,
      message,
      sendMessage: input.sendMessage,
    });
    if (outcome === "SENT") sentCount += 1;
    else failedCount += 1;
  }

  return {
    recipientCount: prepared.recipients.length,
    sentCount,
    failedCount,
  };
}

export type {
  BillingReminderRecipient,
  BillingReminderRule,
  ManualGroupBillingReminderReport,
  ManualReminderGroupConfiguration,
  ReminderDispatchSummary,
};
