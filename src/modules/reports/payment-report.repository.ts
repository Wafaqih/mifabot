import type { Pool, PoolClient } from "pg";

import type {
  ArrearsReportRow,
  PaymentAuditEntry,
  PaymentReportRow,
} from "./payment-report.types.js";

type DatabaseExecutor = Pool | PoolClient;

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function listPaymentReportRows(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  period: string | null,
): Promise<PaymentReportRow[]> {
  const values: unknown[] = [billingDefinitionId];
  const conditions = ["p.billing_definition_id = $1"];
  if (period) {
    values.push(`${period}-01`);
    conditions.push(
      `p.submitted_at >= $${values.length}::date AND p.submitted_at < ($${values.length}::date + INTERVAL '1 month')`,
    );
  }

  const result = await executor.query<{
    payment_id: string;
    payer_name: string;
    payer_username: string;
    ruang_lingkup: PaymentReportRow["scope"];
    nominal: string;
    status: PaymentReportRow["status"];
    submission_type: string;
    channel_name: string | null;
    submitted_at: string;
    verified_at: string | null;
    verifier_name: string | null;
    rejection_reason: string | null;
  }>(
    `SELECT p.id AS payment_id, payer.nama_lengkap AS payer_name,
            payer.username AS payer_username, p.ruang_lingkup, p.nominal,
            p.status, p.submission_type, pc.nama AS channel_name,
            p.submitted_at, p.verified_at, verifier.nama_lengkap AS verifier_name,
            p.rejection_reason
     FROM mifabot.payments p
     JOIN mifabot.users payer ON payer.id = p.user_id
     LEFT JOIN mifabot.users verifier ON verifier.id = p.verified_by
     LEFT JOIN mifabot.payment_channels pc ON pc.id = p.payment_channel_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.submitted_at DESC, p.id DESC
     LIMIT 2000`,
    values,
  );

  return result.rows.map((row) => ({
    paymentId: row.payment_id,
    payerName: row.payer_name,
    payerUsername: row.payer_username,
    scope: row.ruang_lingkup,
    nominal: Number(row.nominal),
    status: row.status,
    submissionType: row.submission_type,
    channelName: row.channel_name,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
    verifierName: row.verifier_name,
    rejectionReason: row.rejection_reason,
  }));
}

export async function listArrearsReportRows(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  asOf: string,
): Promise<ArrearsReportRow[]> {
  const result = await executor.query<{
    bill_id: string;
    student_name: string;
    student_username: string;
    periode_mulai: string;
    periode_selesai: string;
    jatuh_tempo: string;
    nominal: string;
    total_dibayar: string;
    sisa: string;
    status: ArrearsReportRow["status"];
  }>(
    `SELECT b.id AS bill_id, u.nama_lengkap AS student_name,
            u.username AS student_username, b.periode_mulai, b.periode_selesai,
            b.jatuh_tempo, b.nominal, b.status,
            COALESCE(SUM(pa.nominal_alokasi), 0) AS total_dibayar,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
     FROM mifabot.bills b
     JOIN mifabot.users u ON u.id = b.user_id
     LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     WHERE b.billing_definition_id = $1
       AND b.periode_selesai < $2::date
     GROUP BY b.id, u.nama_lengkap, u.username
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.periode_mulai, LOWER(u.nama_lengkap), b.id
     LIMIT 2000`,
    [billingDefinitionId, asOf],
  );
  return result.rows.map((row) => ({
    billId: row.bill_id,
    studentName: row.student_name,
    studentUsername: row.student_username,
    periodeMulai: row.periode_mulai,
    periodeSelesai: row.periode_selesai,
    jatuhTempo: row.jatuh_tempo,
    nominal: Number(row.nominal),
    totalDibayar: Number(row.total_dibayar),
    sisa: Number(row.sisa),
    status: row.status,
  }));
}

export async function listPaymentAuditEntries(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
): Promise<PaymentAuditEntry[]> {
  const result = await executor.query<{
    id: string;
    action: string;
    payment_id: string;
    actor_name: string | null;
    actor_username: string | null;
    created_at: string;
    old_data: unknown;
    new_data: unknown;
  }>(
    `SELECT a.id, a.action, a.entity_id AS payment_id,
            u.nama_lengkap AS actor_name, u.username AS actor_username,
            a.created_at, a.old_data, a.new_data
     FROM mifabot.audit_logs a
     JOIN mifabot.payments p ON p.id = a.entity_id
     LEFT JOIN mifabot.users u ON u.id = a.actor_user_id
     WHERE a.entity_type = 'PAYMENT'
       AND p.billing_definition_id = $1
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 50`,
    [billingDefinitionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    paymentId: row.payment_id,
    actorName: row.actor_name,
    actorUsername: row.actor_username,
    createdAt: row.created_at,
    oldData: jsonObject(row.old_data),
    newData: jsonObject(row.new_data),
  }));
}
