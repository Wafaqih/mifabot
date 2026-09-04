import type { Pool, PoolClient } from "pg";

import type {
  BillingReminderRecipient,
  BillingReminderRule,
  ManualGroupBillingReminderReport,
  ManualReminderGroupConfiguration,
} from "./reminder.types.js";

type DatabaseExecutor = Pool | PoolClient;

interface ReminderRuleRow {
  id: string;
  billing_definition_id: string;
  offset_days: number;
  is_active: boolean;
  configured_by: string | null;
  deactivated_by: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReminderRecipientRow {
  user_id: string;
  username: string;
  jenis_kelamin: "L" | "P";
  nomor_whatsapp: string;
  bill_id: string;
  billing_definition_id: string;
  billing_name: string;
  jatuh_tempo: string;
  sisa: string;
  rule_id?: string;
  offset_days?: number;
}

interface ManualReminderGroupConfigurationRow {
  group_jid: string;
  configured_by: string | null;
  configured_at: string;
  updated_at: string;
}

interface ManualGroupBillingReminderReportRow {
  billing_name: string;
  period_start: string | null;
  santri_paid_count: string;
  santri_target_count: string;
  santri_paid_amount: string;
  santriah_paid_count: string;
  santriah_target_count: string;
  santriah_paid_amount: string;
  total_paid_count: string;
  total_paid_amount: string;
  total_unpaid_count: string;
  total_outstanding_amount: string;
}

function mapRule(row: ReminderRuleRow): BillingReminderRule {
  return {
    id: row.id,
    billingDefinitionId: row.billing_definition_id,
    offsetDays: row.offset_days,
    isActive: row.is_active,
    configuredBy: row.configured_by,
    deactivatedBy: row.deactivated_by,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRecipient(row: ReminderRecipientRow): BillingReminderRecipient {
  return {
    userId: row.user_id,
    username: row.username,
    jenisKelamin: row.jenis_kelamin,
    nomorWhatsapp: row.nomor_whatsapp,
    billId: row.bill_id,
    billingDefinitionId: row.billing_definition_id,
    billingName: row.billing_name,
    jatuhTempo: row.jatuh_tempo,
    sisa: Number(row.sisa),
    ...(row.rule_id
      ? { ruleId: row.rule_id, offsetDays: row.offset_days }
      : {}),
  };
}

function mapManualReminderGroupConfiguration(
  row: ManualReminderGroupConfigurationRow,
): ManualReminderGroupConfiguration {
  return {
    groupJid: row.group_jid,
    configuredBy: row.configured_by,
    configuredAt: row.configured_at,
    updatedAt: row.updated_at,
  };
}

function mapManualGroupBillingReminderReport(
  row: ManualGroupBillingReminderReportRow,
  asOf: string,
): ManualGroupBillingReminderReport {
  if (!row.period_start) {
    throw new Error("Periode tagihan berjalan tidak ditemukan.");
  }
  return {
    billingName: row.billing_name,
    periodStart: row.period_start,
    asOf,
    santriPaidCount: Number(row.santri_paid_count),
    santriTargetCount: Number(row.santri_target_count),
    santriPaidAmount: Number(row.santri_paid_amount),
    santriahPaidCount: Number(row.santriah_paid_count),
    santriahTargetCount: Number(row.santriah_target_count),
    santriahPaidAmount: Number(row.santriah_paid_amount),
    totalPaidCount: Number(row.total_paid_count),
    totalPaidAmount: Number(row.total_paid_amount),
    totalUnpaidCount: Number(row.total_unpaid_count),
    totalOutstandingAmount: Number(row.total_outstanding_amount),
  };
}

/** Locking the definition makes a full Set reminder replacement atomic. */
export async function getReminderDefinitionState(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  lock = false,
): Promise<{ isActive: boolean } | null> {
  const result = await executor.query<{ is_active: boolean }>(
    `SELECT is_active
     FROM mifabot.billing_definitions
     WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [billingDefinitionId],
  );
  return result.rows[0] ? { isActive: result.rows[0].is_active } : null;
}

export async function setManualReminderGroupConfiguration(
  client: PoolClient,
  input: { groupJid: string; configuredBy: string | null },
): Promise<ManualReminderGroupConfiguration> {
  const result = await client.query<ManualReminderGroupConfigurationRow>(
    `INSERT INTO mifabot.manual_reminder_group_configuration (
       id, group_jid, configured_by
     ) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE
     SET group_jid = EXCLUDED.group_jid,
         configured_by = EXCLUDED.configured_by,
         configured_at = now(),
         updated_at = now()
     RETURNING group_jid, configured_by, configured_at, updated_at`,
    [input.groupJid, input.configuredBy],
  );
  return mapManualReminderGroupConfiguration(result.rows[0]!);
}

export async function getManualReminderGroupConfiguration(
  executor: DatabaseExecutor,
): Promise<ManualReminderGroupConfiguration | null> {
  const result = await executor.query<ManualReminderGroupConfigurationRow>(
    `SELECT group_jid, configured_by, configured_at, updated_at
     FROM mifabot.manual_reminder_group_configuration
     WHERE id = 1`,
  );
  return result.rows[0]
    ? mapManualReminderGroupConfiguration(result.rows[0])
    : null;
}

/**
 * Reports every current bill in the definition's active period. Payments are
 * accumulated from that period's issue date up through `asOf`, never limited
 * to payments that happened on the report date alone.
 */
export async function getManualGroupBillingReminderReport(
  executor: DatabaseExecutor,
  input: { billingDefinitionId: string; asOf: string },
): Promise<ManualGroupBillingReminderReport | null> {
  const result = await executor.query<ManualGroupBillingReminderReportRow>(
    `WITH bill_progress AS (
       SELECT b.id, b.periode_mulai, b.nominal, u.jenis_kelamin,
              COALESCE(
                SUM(
                  CASE WHEN p.id IS NOT NULL THEN pa.nominal_alokasi ELSE 0 END
                ),
                0
              ) AS total_dibayar
       FROM mifabot.bills b
       JOIN mifabot.billing_definitions d ON d.id = b.billing_definition_id
       JOIN mifabot.users u ON u.id = b.user_id
       JOIN mifabot.roles role ON role.id = u.role_id
       LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
       LEFT JOIN mifabot.payments p
         ON p.id = pa.payment_id
        AND p.status = 'APPROVED'
        AND p.verified_at < ($2::date + 1)::timestamp
       WHERE b.billing_definition_id = $1
         AND d.is_active
         AND u.status = 'AKTIF'
         AND role.kode = 'USER'
         AND b.periode_mulai <= $2::date
         AND b.periode_selesai >= $2::date
       GROUP BY b.id, b.periode_mulai, b.nominal, u.jenis_kelamin
     )
     SELECT d.nama AS billing_name,
            MIN(progress.periode_mulai)::text AS period_start,
            COUNT(progress.id) FILTER (WHERE progress.jenis_kelamin = 'L') AS santri_target_count,
            COUNT(progress.id) FILTER (
              WHERE progress.jenis_kelamin = 'L' AND progress.total_dibayar > 0
            ) AS santri_paid_count,
            COALESCE(SUM(progress.total_dibayar) FILTER (
              WHERE progress.jenis_kelamin = 'L'
            ), 0) AS santri_paid_amount,
            COUNT(progress.id) FILTER (WHERE progress.jenis_kelamin = 'P') AS santriah_target_count,
            COUNT(progress.id) FILTER (
              WHERE progress.jenis_kelamin = 'P' AND progress.total_dibayar > 0
            ) AS santriah_paid_count,
            COALESCE(SUM(progress.total_dibayar) FILTER (
              WHERE progress.jenis_kelamin = 'P'
            ), 0) AS santriah_paid_amount,
            COUNT(progress.id) FILTER (WHERE progress.total_dibayar > 0) AS total_paid_count,
            COALESCE(SUM(progress.total_dibayar), 0) AS total_paid_amount,
            COUNT(progress.id) FILTER (WHERE progress.total_dibayar = 0) AS total_unpaid_count,
            COALESCE(SUM(GREATEST(progress.nominal - progress.total_dibayar, 0)), 0)
              AS total_outstanding_amount
     FROM mifabot.billing_definitions d
     LEFT JOIN bill_progress progress ON true
     WHERE d.id = $1
     GROUP BY d.nama`,
    [input.billingDefinitionId, input.asOf],
  );
  return result.rows[0]?.period_start
    ? mapManualGroupBillingReminderReport(result.rows[0], input.asOf)
    : null;
}

export async function listActiveBillingReminderRules(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
): Promise<BillingReminderRule[]> {
  const result = await executor.query<ReminderRuleRow>(
    `SELECT id, billing_definition_id, offset_days, is_active, configured_by,
            deactivated_by, deactivated_at, created_at, updated_at
     FROM mifabot.billing_reminder_rules
     WHERE billing_definition_id = $1
       AND is_active
     ORDER BY offset_days, id`,
    [billingDefinitionId],
  );
  return result.rows.map(mapRule);
}

export async function deactivateMissingBillingReminderRules(
  client: PoolClient,
  input: {
    billingDefinitionId: string;
    retainedOffsets: number[];
    deactivatedBy: string | null;
  },
): Promise<void> {
  const values: unknown[] = [input.billingDefinitionId, input.deactivatedBy];
  let retainedCondition = "";
  if (input.retainedOffsets.length > 0) {
    values.push(input.retainedOffsets);
    retainedCondition = ` AND NOT (offset_days = ANY($3::smallint[]))`;
  }
  await client.query(
    `UPDATE mifabot.billing_reminder_rules
     SET is_active = false, deactivated_by = $2
     WHERE billing_definition_id = $1
       AND is_active${retainedCondition}`,
    values,
  );
}

export async function insertBillingReminderRule(
  client: PoolClient,
  input: {
    billingDefinitionId: string;
    offsetDays: number;
    configuredBy: string | null;
  },
): Promise<BillingReminderRule> {
  const result = await client.query<ReminderRuleRow>(
    `INSERT INTO mifabot.billing_reminder_rules (
       billing_definition_id, offset_days, configured_by
     ) VALUES ($1, $2::smallint, $3)
     RETURNING id, billing_definition_id, offset_days, is_active, configured_by,
       deactivated_by, deactivated_at, created_at, updated_at`,
    [input.billingDefinitionId, input.offsetDays, input.configuredBy],
  );
  return mapRule(result.rows[0]!);
}

export async function findAutomaticBillingReminderRecipients(
  executor: DatabaseExecutor,
  asOf: string,
): Promise<BillingReminderRecipient[]> {
  const result = await executor.query<ReminderRecipientRow>(
    `SELECT u.id AS user_id, u.username, u.jenis_kelamin, u.nomor_whatsapp,
            b.id AS bill_id, b.billing_definition_id,
            COALESCE(b.nama_tagihan_snapshot, d.nama) AS billing_name,
            b.jatuh_tempo,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa,
            r.id AS rule_id, r.offset_days
     FROM mifabot.billing_reminder_rules r
     JOIN mifabot.billing_definitions d
       ON d.id = r.billing_definition_id
     JOIN mifabot.bills b
       ON b.billing_definition_id = r.billing_definition_id
     JOIN mifabot.users u ON u.id = b.user_id
     JOIN mifabot.roles role ON role.id = u.role_id
     LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     LEFT JOIN mifabot.billing_reminder_deliveries retry
       ON retry.billing_reminder_rule_id = r.id
      AND retry.bill_id = b.id
      AND retry.status = 'FAILED'
     WHERE r.is_active
       AND d.is_active
       AND u.status = 'AKTIF'
       AND role.kode = 'USER'
       AND (
         b.jatuh_tempo + r.offset_days::integer = $1::date
         -- A failed H-offset is retried later without creating a second
         -- delivery row.  A paid/inactive bill is still excluded below.
         OR (retry.id IS NOT NULL AND retry.scheduled_for <= $1::date)
       )
     GROUP BY r.id, r.offset_days, b.id, b.billing_definition_id,
              b.nama_tagihan_snapshot, d.nama, b.jatuh_tempo, b.nominal,
              u.id, u.username, u.jenis_kelamin, u.nomor_whatsapp
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.jatuh_tempo, r.offset_days, LOWER(u.username), b.id`,
    [asOf],
  );
  return result.rows.map(mapRecipient);
}

/** All current and arrears bills for one definition that are still unpaid. */
export async function findManualBillingReminderRecipients(
  executor: DatabaseExecutor,
  input: { billingDefinitionId: string; asOf: string },
): Promise<BillingReminderRecipient[]> {
  const result = await executor.query<ReminderRecipientRow>(
    `SELECT u.id AS user_id, u.username, u.jenis_kelamin, u.nomor_whatsapp,
            b.id AS bill_id, b.billing_definition_id,
            COALESCE(b.nama_tagihan_snapshot, d.nama) AS billing_name,
            b.jatuh_tempo,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
     FROM mifabot.bills b
     JOIN mifabot.billing_definitions d ON d.id = b.billing_definition_id
     JOIN mifabot.users u ON u.id = b.user_id
     JOIN mifabot.roles role ON role.id = u.role_id
     LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     WHERE b.billing_definition_id = $1
       AND d.is_active
       AND u.status = 'AKTIF'
       AND role.kode = 'USER'
       AND b.periode_mulai <= $2::date
     GROUP BY b.id, b.billing_definition_id, b.nama_tagihan_snapshot,
              d.nama, b.jatuh_tempo, b.nominal,
              u.id, u.username, u.jenis_kelamin, u.nomor_whatsapp
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.jatuh_tempo, LOWER(u.username), b.id`,
    [input.billingDefinitionId, input.asOf],
  );
  return result.rows.map(mapRecipient);
}

export async function createManualBillingReminderBatch(
  client: PoolClient,
  input: {
    billingDefinitionId: string;
    requestedBy: string | null;
    asOf: string;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO mifabot.billing_reminder_manual_batches (
       billing_definition_id, requested_by, as_of_date
     ) VALUES ($1, $2, $3::date)
     RETURNING id`,
    [input.billingDefinitionId, input.requestedBy, input.asOf],
  );
  return result.rows[0]!.id;
}

/**
 * Claim an automatic delivery.  A failed row is reused for a retry, while a
 * pending or sent row is left untouched to prevent duplicate sends.
 */
export async function claimAutomaticBillingReminderDelivery(
  executor: DatabaseExecutor,
  input: { ruleId: string; billId: string; messageBody: string },
): Promise<string | null> {
  const result = await executor.query<{ id: string }>(
    `WITH eligible AS (
       SELECT b.id AS bill_id, b.user_id,
              b.jatuh_tempo + r.offset_days::integer AS scheduled_for
       FROM mifabot.billing_reminder_rules r
       JOIN mifabot.billing_definitions d
         ON d.id = r.billing_definition_id
       JOIN mifabot.bills b
         ON b.billing_definition_id = r.billing_definition_id
       JOIN mifabot.users u ON u.id = b.user_id
       JOIN mifabot.roles role ON role.id = u.role_id
       LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
       WHERE r.id = $1
         AND r.is_active
         AND d.is_active
         AND b.id = $2
         AND u.status = 'AKTIF'
         AND role.kode = 'USER'
       GROUP BY b.id, b.user_id, b.jatuh_tempo, r.offset_days
       HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     )
     INSERT INTO mifabot.billing_reminder_deliveries (
       billing_reminder_rule_id, bill_id, user_id, scheduled_for, message_body,
       attempt_count, last_attempt_at
     )
     SELECT $1, eligible.bill_id, eligible.user_id, eligible.scheduled_for, $3,
            1, now()
     FROM eligible
     ON CONFLICT (billing_reminder_rule_id, bill_id)
       WHERE billing_reminder_rule_id IS NOT NULL
     DO UPDATE SET
       status = 'PENDING'::mifabot.status_notifikasi,
       sent_at = NULL,
       failure_reason = NULL,
       message_body = EXCLUDED.message_body,
       attempt_count = mifabot.billing_reminder_deliveries.attempt_count + 1,
       last_attempt_at = now()
     WHERE mifabot.billing_reminder_deliveries.status = 'FAILED'
     RETURNING id`,
    [input.ruleId, input.billId, input.messageBody],
  );
  return result.rows[0]?.id ?? null;
}

export async function claimManualBillingReminderDelivery(
  executor: DatabaseExecutor,
  input: { batchId: string; billId: string; messageBody: string },
): Promise<string | null> {
  const result = await executor.query<{ id: string }>(
    `WITH eligible AS (
       SELECT b.id AS bill_id, b.user_id, batch.as_of_date
       FROM mifabot.billing_reminder_manual_batches batch
       JOIN mifabot.billing_definitions d
         ON d.id = batch.billing_definition_id
       JOIN mifabot.bills b
         ON b.billing_definition_id = batch.billing_definition_id
       JOIN mifabot.users u ON u.id = b.user_id
       JOIN mifabot.roles role ON role.id = u.role_id
       LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
       WHERE batch.id = $1
         AND d.is_active
         AND b.id = $2
         AND b.periode_mulai <= batch.as_of_date
         AND u.status = 'AKTIF'
         AND role.kode = 'USER'
       GROUP BY b.id, b.user_id, batch.as_of_date
       HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     )
     INSERT INTO mifabot.billing_reminder_deliveries (
       billing_reminder_manual_batch_id, bill_id, user_id, scheduled_for,
       message_body, attempt_count, last_attempt_at
     )
     SELECT $1, eligible.bill_id, eligible.user_id, eligible.as_of_date, $3,
            1, now()
     FROM eligible
     ON CONFLICT (billing_reminder_manual_batch_id, bill_id)
       WHERE billing_reminder_manual_batch_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [input.batchId, input.billId, input.messageBody],
  );
  return result.rows[0]?.id ?? null;
}

export async function markBillingReminderDeliverySent(
  executor: DatabaseExecutor,
  deliveryId: string,
): Promise<void> {
  await executor.query(
    `UPDATE mifabot.billing_reminder_deliveries
     SET status = 'SENT', sent_at = now(), failure_reason = NULL
     WHERE id = $1
       AND status = 'PENDING'`,
    [deliveryId],
  );
}

export async function markBillingReminderDeliveryFailed(
  executor: DatabaseExecutor,
  input: { deliveryId: string; reason: string },
): Promise<void> {
  await executor.query(
    `UPDATE mifabot.billing_reminder_deliveries
     SET status = 'FAILED', failure_reason = $2
     WHERE id = $1
       AND status = 'PENDING'`,
    [input.deliveryId, input.reason],
  );
}
