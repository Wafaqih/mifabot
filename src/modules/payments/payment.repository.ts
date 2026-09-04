import type { Pool, PoolClient } from "pg";

import type { Bill } from "../billing/billing.types.js";
import type {
  ApprovedPaymentReview,
  Payment,
  PaymentChannel,
  PaymentMethod,
  PendingPaymentReview,
  PaymentReversal,
  PaymentScope,
  PaymentStatus,
  PaymentSubmissionType,
} from "./payment.types.js";

type DatabaseExecutor = Pool | PoolClient;

interface PaymentRow {
  id: string;
  user_id: string;
  submitted_by: string;
  routed_to_admin_id: string;
  verified_by: string | null;
  requested_bill_id: string | null;
  payment_channel_id: string | null;
  billing_definition_id: string;
  billing_name: string;
  ruang_lingkup: PaymentScope;
  nominal: string;
  proof_storage_key: string | null;
  submission_type: PaymentSubmissionType;
  status: PaymentStatus;
  submitted_at: string;
  review_notified_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
}

interface ChannelRow {
  id: string;
  admin_user_id: string;
  nama: string;
  metode: PaymentMethod;
  nomor_rekening: string | null;
  nama_pemilik: string | null;
  instruksi: string | null;
  urutan: number;
}

interface ArrearsBillRow {
  id: string;
  nominal: string;
  total_dibayar: string;
  sisa: string;
}

interface PendingPaymentReviewRow extends PaymentRow {
  payer_name: string;
  payer_username: string;
  payer_whatsapp_number: string;
  reviewer_whatsapp_number: string;
}

interface PaymentReversalRow {
  id: string;
  payment_id: string;
  reversed_by: string;
  reason: string;
  reversed_at: string;
}

export interface PaymentAllocationSnapshot {
  billId: string;
  nominal: number;
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    userId: row.user_id,
    submittedBy: row.submitted_by,
    routedToAdminId: row.routed_to_admin_id,
    verifiedBy: row.verified_by,
    requestedBillId: row.requested_bill_id,
    paymentChannelId: row.payment_channel_id,
    billingDefinitionId: row.billing_definition_id,
    billingName: row.billing_name,
    ruangLingkup: row.ruang_lingkup,
    nominal: Number(row.nominal),
    proofStorageKey: row.proof_storage_key,
    submissionType: row.submission_type,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewNotifiedAt: row.review_notified_at,
    verifiedAt: row.verified_at,
    rejectionReason: row.rejection_reason,
  };
}

function mapPendingPaymentReview(
  row: PendingPaymentReviewRow,
): PendingPaymentReview {
  return {
    ...mapPayment(row),
    payerName: row.payer_name,
    payerUsername: row.payer_username,
    payerWhatsAppNumber: row.payer_whatsapp_number,
    reviewerWhatsAppNumber: row.reviewer_whatsapp_number,
  };
}

function mapChannel(row: ChannelRow): PaymentChannel {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    nama: row.nama,
    metode: row.metode,
    nomorRekening: row.nomor_rekening,
    namaPemilik: row.nama_pemilik,
    instruksi: row.instruksi,
    urutan: row.urutan,
  };
}

function mapPaymentReversal(row: PaymentReversalRow): PaymentReversal {
  return {
    id: row.id,
    paymentId: row.payment_id,
    reversedBy: row.reversed_by,
    reason: row.reason,
    reversedAt: row.reversed_at,
  };
}

const paymentSelect = `
  SELECT p.id, p.user_id, p.submitted_by, p.routed_to_admin_id,
         p.verified_by, p.requested_bill_id, p.payment_channel_id,
         p.billing_definition_id, COALESCE(p.nama_tagihan_snapshot, d.nama) AS billing_name, p.ruang_lingkup,
         p.nominal, p.proof_storage_key, p.submission_type, p.status,
         p.submitted_at, p.review_notified_at, p.verified_at, p.rejection_reason
  FROM mifabot.payments p
  JOIN mifabot.billing_definitions d ON d.id = p.billing_definition_id
`;

const pendingPaymentReviewSelect = `
  SELECT p.id, p.user_id, p.submitted_by, p.routed_to_admin_id,
         p.verified_by, p.requested_bill_id, p.payment_channel_id,
         p.billing_definition_id, COALESCE(p.nama_tagihan_snapshot, d.nama) AS billing_name,
         p.ruang_lingkup, p.nominal, p.proof_storage_key, p.submission_type,
         p.status, p.submitted_at, p.review_notified_at, p.verified_at, p.rejection_reason,
         u.nama_lengkap AS payer_name, u.username AS payer_username,
         u.nomor_whatsapp AS payer_whatsapp_number,
         reviewer.nomor_whatsapp AS reviewer_whatsapp_number
  FROM mifabot.payments p
  JOIN mifabot.billing_definitions d ON d.id = p.billing_definition_id
  JOIN mifabot.users u ON u.id = p.user_id
  JOIN mifabot.users reviewer ON reviewer.id = p.routed_to_admin_id
`;

export async function listActiveChannels(
  client: PoolClient,
  billingDefinitionId: string,
): Promise<PaymentChannel[]> {
  const result = await client.query<ChannelRow>(
    `SELECT pc.id, pc.admin_user_id, pc.nama, pc.metode, pc.nomor_rekening,
            pc.nama_pemilik, pc.instruksi, pc.urutan
     FROM mifabot.payment_channels pc
     JOIN mifabot.payment_channel_definitions pcd
       ON pcd.payment_channel_id = pc.id
      AND pcd.billing_definition_id = $1
     JOIN mifabot.billing_definition_responsibles br
       ON br.user_id = pc.admin_user_id
      AND br.billing_definition_id = $1
      AND br.is_active
     WHERE pc.is_active
     ORDER BY CASE
                WHEN pc.metode = 'BANK_TRANSFER' THEN 1
                WHEN pc.metode IN ('DANA', 'E_WALLET') THEN 2
                WHEN pc.metode = 'CASH' THEN 3
                ELSE 4
              END,
              LOWER(pc.nama), pc.id`,
    [billingDefinitionId],
  );
  return result.rows.map(mapChannel);
}

export async function getActiveChannel(
  client: PoolClient,
  channelId: string,
  billingDefinitionId: string,
): Promise<PaymentChannel | null> {
  const result = await client.query<ChannelRow>(
    `SELECT pc.id, pc.admin_user_id, pc.nama, pc.metode, pc.nomor_rekening,
            pc.nama_pemilik, pc.instruksi, pc.urutan
     FROM mifabot.payment_channels pc
     JOIN mifabot.payment_channel_definitions pcd
       ON pcd.payment_channel_id = pc.id
      AND pcd.billing_definition_id = $2
     JOIN mifabot.billing_definition_responsibles br
       ON br.user_id = pc.admin_user_id
      AND br.billing_definition_id = $2
      AND br.is_active
     WHERE pc.id = $1 AND pc.is_active`,
    [channelId, billingDefinitionId],
  );
  return result.rows[0] ? mapChannel(result.rows[0]) : null;
}

export async function listDefinitionPaymentChannels(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
): Promise<PaymentChannel[]> {
  const result = await executor.query<ChannelRow>(
    `SELECT pc.id, pc.admin_user_id, pc.nama, pc.metode, pc.nomor_rekening,
            pc.nama_pemilik, pc.instruksi, pc.urutan
     FROM mifabot.payment_channels pc
     JOIN mifabot.payment_channel_definitions pcd
       ON pcd.payment_channel_id = pc.id
     WHERE pcd.billing_definition_id = $1
       AND pc.is_active
     ORDER BY CASE
                WHEN pc.metode = 'BANK_TRANSFER' THEN 1
                WHEN pc.metode IN ('DANA', 'E_WALLET') THEN 2
                WHEN pc.metode = 'CASH' THEN 3
                ELSE 4
              END,
              LOWER(pc.nama), pc.id`,
    [billingDefinitionId],
  );
  return result.rows.map(mapChannel);
}

export async function insertDefinitionPaymentChannel(
  client: PoolClient,
  input: {
    billingDefinitionId: string;
    adminUserId: string;
    nama: string;
    metode: PaymentMethod;
    nomorRekening: string | null;
    namaPemilik: string | null;
    instruksi: string | null;
    urutan: number;
  },
): Promise<PaymentChannel> {
  const result = await client.query<ChannelRow>(
    `WITH channel AS (
       INSERT INTO mifabot.payment_channels (
         admin_user_id, nama, metode, nomor_rekening, nama_pemilik, instruksi, urutan
       ) VALUES ($1, $2, $3::mifabot.jenis_metode_pembayaran, $4, $5, $6, $7)
       RETURNING id, admin_user_id, nama, metode, nomor_rekening, nama_pemilik, instruksi, urutan
     ), linked AS (
       INSERT INTO mifabot.payment_channel_definitions (
         payment_channel_id, billing_definition_id
       ) SELECT id, $8 FROM channel
     )
     SELECT id, admin_user_id, nama, metode, nomor_rekening, nama_pemilik, instruksi, urutan
     FROM channel`,
    [
      input.adminUserId,
      input.nama,
      input.metode,
      input.nomorRekening,
      input.namaPemilik,
      input.instruksi,
      input.urutan,
      input.billingDefinitionId,
    ],
  );
  return mapChannel(result.rows[0]!);
}

export async function updateDefinitionPaymentChannel(
  client: PoolClient,
  input: {
    billingDefinitionId: string;
    channelId: string;
    nama?: string;
    nomorRekening?: string | null;
    namaPemilik?: string | null;
    instruksi?: string | null;
  },
): Promise<PaymentChannel | null> {
  const result = await client.query<ChannelRow>(
    `UPDATE mifabot.payment_channels pc
     SET nama = COALESCE($3, pc.nama),
         nomor_rekening = COALESCE($4, pc.nomor_rekening),
         nama_pemilik = COALESCE($5, pc.nama_pemilik),
         instruksi = COALESCE($6, pc.instruksi),
         updated_at = now()
     FROM mifabot.payment_channel_definitions pcd
     WHERE pc.id = pcd.payment_channel_id
       AND pcd.billing_definition_id = $1
       AND pc.id = $2
       AND pc.is_active
     RETURNING pc.id, pc.admin_user_id, pc.nama, pc.metode, pc.nomor_rekening,
               pc.nama_pemilik, pc.instruksi, pc.urutan`,
    [
      input.billingDefinitionId,
      input.channelId,
      input.nama ?? null,
      input.nomorRekening ?? null,
      input.namaPemilik ?? null,
      input.instruksi ?? null,
    ],
  );
  return result.rows[0] ? mapChannel(result.rows[0]) : null;
}

export async function deactivateDefinitionPaymentChannel(
  client: PoolClient,
  billingDefinitionId: string,
  channelId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE mifabot.payment_channels pc
     SET is_active = false, updated_at = now()
     FROM mifabot.payment_channel_definitions pcd
     WHERE pc.id = pcd.payment_channel_id
       AND pcd.billing_definition_id = $1
       AND pc.id = $2
       AND pc.is_active`,
    [billingDefinitionId, channelId],
  );
  return result.rowCount === 1;
}

export async function getUserRole(
  client: PoolClient,
  userId: string,
): Promise<string | null> {
  const result = await client.query<{ kode: string }>(
    `SELECT r.kode
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  return result.rows[0]?.kode ?? null;
}

export async function isActiveDefinitionResponsible(
  client: PoolClient,
  billingDefinitionId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM mifabot.billing_definition_responsibles
       WHERE billing_definition_id = $1 AND user_id = $2 AND is_active
     ) AS exists`,
    [billingDefinitionId, userId],
  );
  return result.rows[0]?.exists ?? false;
}

export async function getBillForPayment(
  client: PoolClient,
  billId: string,
  userId: string,
  billingDefinitionId: string,
): Promise<Bill | null> {
  await client.query(
    `SELECT id FROM mifabot.bills
     WHERE id = $1 AND user_id = $2 AND billing_definition_id = $3
     FOR UPDATE`,
    [billId, userId, billingDefinitionId],
  );
  const result = await client.query<
    ArrearsBillRow & {
      user_id: string;
      billing_definition_id: string;
      billing_name: string;
      tariff_id: string | null;
      periode_mulai: string;
      periode_selesai: string;
      jatuh_tempo: string;
      status: Bill["status"];
    }
  >(
    `SELECT b.id, b.user_id, b.billing_definition_id,
            COALESCE(b.nama_tagihan_snapshot, d.nama) AS billing_name,
            b.tariff_id, b.periode_mulai, b.periode_selesai, b.jatuh_tempo,
            b.status, b.nominal,
            COALESCE(SUM(pa.nominal_alokasi), 0) AS total_dibayar,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
     FROM mifabot.bills b
     JOIN mifabot.billing_definitions d ON d.id = b.billing_definition_id
     LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     WHERE b.id = $1 AND b.user_id = $2 AND b.billing_definition_id = $3
     GROUP BY b.id, d.nama`,
    [billId, userId, billingDefinitionId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    billingDefinitionId: row.billing_definition_id,
    billingName: row.billing_name,
    tariffId: row.tariff_id,
    periodeMulai: row.periode_mulai,
    periodeSelesai: row.periode_selesai,
    jatuhTempo: row.jatuh_tempo,
    nominal: Number(row.nominal),
    status: row.status,
    totalDibayar: Number(row.total_dibayar),
    sisa: Number(row.sisa),
  };
}

export async function getArrearsBills(
  client: PoolClient,
  userId: string,
  billingDefinitionId: string,
  asOf: string,
  billIds: string[],
): Promise<Array<{ billId: string; outstanding: number }>> {
  await client.query(
    `SELECT id FROM mifabot.bills
     WHERE user_id = $1 AND billing_definition_id = $2
       AND periode_selesai < $3::date AND id = ANY($4::uuid[])
     FOR UPDATE`,
    [userId, billingDefinitionId, asOf, billIds],
  );
  const result = await client.query<ArrearsBillRow>(
    `SELECT b.id, b.nominal, COALESCE(SUM(pa.nominal_alokasi), 0) AS total_dibayar,
            b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
     FROM mifabot.bills b
     LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
     WHERE b.user_id = $1 AND b.billing_definition_id = $2
       AND b.periode_selesai < $3::date AND b.id = ANY($4::uuid[])
     GROUP BY b.id
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.periode_mulai`,
    [userId, billingDefinitionId, asOf, billIds],
  );
  return result.rows.map((row) => ({
    billId: row.id,
    outstanding: Number(row.sisa),
  }));
}

export async function insertPayment(
  client: PoolClient,
  input: {
    userId: string;
    submittedBy: string;
    routedToAdminId: string;
    requestedBillId: string | null;
    paymentChannelId: string | null;
    billingDefinitionId: string;
    ruangLingkup: PaymentScope;
    nominal: number;
    proofStorageKey: string | null;
    submissionType: PaymentSubmissionType;
    status: PaymentStatus;
    verifiedBy: string | null;
  },
): Promise<Payment> {
  const result = await client.query<PaymentRow>(
    `WITH inserted AS (
       INSERT INTO mifabot.payments (
         user_id, submitted_by, routed_to_admin_id, requested_bill_id,
         payment_channel_id, billing_definition_id, ruang_lingkup, nominal,
         proof_storage_key, submission_type, status, verified_by, verified_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::mifabot.ruang_lingkup_pembayaran,
                 $8, $9, $10::mifabot.submission_type_pembayaran,
                 $11::mifabot.status_pembayaran, $12::uuid,
                 CASE WHEN $12::uuid IS NULL THEN NULL ELSE now() END)
       RETURNING *
     )
     SELECT inserted.id, inserted.user_id, inserted.submitted_by,
            inserted.routed_to_admin_id, inserted.verified_by,
            inserted.requested_bill_id, inserted.payment_channel_id,
            inserted.billing_definition_id,
            COALESCE(inserted.nama_tagihan_snapshot, d.nama) AS billing_name,
            inserted.ruang_lingkup, inserted.nominal, inserted.proof_storage_key,
            inserted.submission_type, inserted.status, inserted.submitted_at,
            inserted.review_notified_at, inserted.verified_at, inserted.rejection_reason
     FROM inserted
     JOIN mifabot.billing_definitions d ON d.id = inserted.billing_definition_id`,
    [
      input.userId,
      input.submittedBy,
      input.routedToAdminId,
      input.requestedBillId,
      input.paymentChannelId,
      input.billingDefinitionId,
      input.ruangLingkup,
      input.nominal,
      input.proofStorageKey,
      input.submissionType,
      input.status,
      input.verifiedBy,
    ],
  );
  return mapPayment(result.rows[0]!);
}

export async function insertArrearsSelections(
  client: PoolClient,
  paymentId: string,
  selections: Array<{ billId: string; nominalWajib: number }>,
): Promise<void> {
  for (const selection of selections) {
    await client.query(
      `INSERT INTO mifabot.payment_arrears_selections (payment_id, bill_id, nominal_wajib)
       VALUES ($1, $2, $3)`,
      [paymentId, selection.billId, selection.nominalWajib],
    );
  }
}

export async function getArrearsSelections(
  client: PoolClient,
  paymentId: string,
): Promise<Array<{ billId: string; nominalWajib: number }>> {
  const result = await client.query<{ bill_id: string; nominal_wajib: string }>(
    `SELECT bill_id, nominal_wajib
     FROM mifabot.payment_arrears_selections selection
     JOIN mifabot.bills bill ON bill.id = selection.bill_id
     WHERE payment_id = $1
     ORDER BY bill.periode_mulai, bill.periode_selesai, bill.id`,
    [paymentId],
  );
  return result.rows.map((row) => ({
    billId: row.bill_id,
    nominalWajib: Number(row.nominal_wajib),
  }));
}

export async function insertAllocations(
  client: PoolClient,
  paymentId: string,
  allocations: Array<{ billId: string; nominal: number }>,
): Promise<void> {
  for (const allocation of allocations) {
    await client.query(
      `INSERT INTO mifabot.payment_allocations (payment_id, bill_id, nominal_alokasi)
       VALUES ($1, $2, $3)`,
      [paymentId, allocation.billId, allocation.nominal],
    );
  }
}

export async function getPayment(
  client: PoolClient,
  paymentId: string,
): Promise<Payment | null> {
  const result = await client.query<PaymentRow>(
    `${paymentSelect}
     WHERE p.id = $1
     FOR UPDATE OF p`,
    [paymentId],
  );
  return result.rows[0] ? mapPayment(result.rows[0]) : null;
}

/**
 * Lists only payments routed to this PJ.  The service still performs the
 * definitive authorization when a decision is written, but restricting the
 * inbox here avoids exposing another PJ's submissions in WhatsApp.
 */
export async function listPendingPaymentsForReviewer(
  client: PoolClient,
  reviewerId: string,
): Promise<PendingPaymentReview[]> {
  const result = await client.query<PendingPaymentReviewRow>(
    `${pendingPaymentReviewSelect}
     WHERE p.status = 'PENDING'
       AND p.routed_to_admin_id = $1
     ORDER BY p.submitted_at, p.id`,
    [reviewerId],
  );
  return result.rows.map((row) => ({
    ...mapPayment(row),
    payerName: row.payer_name,
    payerUsername: row.payer_username,
    payerWhatsAppNumber: row.payer_whatsapp_number,
    reviewerWhatsAppNumber: row.reviewer_whatsapp_number,
  }));
}

export async function getActivePaymentReviewForReviewer(
  client: PoolClient,
  reviewerId: string,
): Promise<PendingPaymentReview | null> {
  const result = await client.query<PendingPaymentReviewRow>(
    `${pendingPaymentReviewSelect}
     WHERE p.status = 'PENDING'
       AND p.routed_to_admin_id = $1
       AND p.review_notified_at IS NOT NULL
     ORDER BY p.review_notified_at, p.submitted_at, p.id
     LIMIT 1`,
    [reviewerId],
  );
  return result.rows[0] ? mapPendingPaymentReview(result.rows[0]) : null;
}

/**
 * Claims the oldest queued payment only when this PJ has no active review.
 * The transaction advisory lock serializes concurrent submissions for the
 * same PJ, so exactly one payment becomes visible to them at a time.
 */
export async function claimNextPaymentReviewForReviewer(
  client: PoolClient,
  reviewerId: string,
): Promise<PendingPaymentReview | null> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`mifabot-payment-review:${reviewerId}`],
  );

  const active = await getActivePaymentReviewForReviewer(client, reviewerId);
  if (active) return null;

  const candidate = await client.query<{ id: string }>(
    `SELECT id
     FROM mifabot.payments
     WHERE status = 'PENDING'
       AND routed_to_admin_id = $1
       AND review_notified_at IS NULL
     ORDER BY submitted_at, id
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [reviewerId],
  );
  const paymentId = candidate.rows[0]?.id;
  if (!paymentId) return null;

  await client.query(
    `UPDATE mifabot.payments
     SET review_notified_at = now()
     WHERE id = $1`,
    [paymentId],
  );

  const claimed = await client.query<PendingPaymentReviewRow>(
    `${pendingPaymentReviewSelect}
     WHERE p.id = $1`,
    [paymentId],
  );
  return claimed.rows[0] ? mapPendingPaymentReview(claimed.rows[0]) : null;
}

/** Releases a review if WhatsApp delivery failed, preserving its queue order. */
export async function releasePaymentReview(
  client: PoolClient,
  paymentId: string,
  reviewerId: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`mifabot-payment-review:${reviewerId}`],
  );
  await client.query(
    `UPDATE mifabot.payments
     SET review_notified_at = NULL
     WHERE id = $1
       AND routed_to_admin_id = $2
       AND status = 'PENDING'`,
    [paymentId, reviewerId],
  );
}

export async function listApprovedPaymentsForReviewer(
  client: PoolClient,
  billingDefinitionId: string,
): Promise<ApprovedPaymentReview[]> {
  const result = await client.query<PendingPaymentReviewRow>(
    `${pendingPaymentReviewSelect}
     WHERE p.status = 'APPROVED'
       AND p.billing_definition_id = $1
     ORDER BY p.verified_at DESC NULLS LAST, p.submitted_at DESC, p.id DESC
     LIMIT 50`,
    [billingDefinitionId],
  );
  return result.rows.map((row) => ({
    ...mapPayment(row),
    payerName: row.payer_name,
    payerUsername: row.payer_username,
    payerWhatsAppNumber: row.payer_whatsapp_number,
    reviewerWhatsAppNumber: row.reviewer_whatsapp_number,
  }));
}

export async function updatePaymentDecision(
  client: PoolClient,
  paymentId: string,
  verifierId: string,
  approve: boolean,
  rejectionReason: string | null,
): Promise<Payment> {
  const result = await client.query<PaymentRow>(
    `WITH updated AS (
       UPDATE mifabot.payments
       SET status = $2::mifabot.status_pembayaran,
           verified_by = $3,
           verified_at = now(),
           rejection_reason = $4
       WHERE id = $1
       RETURNING *
     )
     SELECT updated.id, updated.user_id, updated.submitted_by,
            updated.routed_to_admin_id, updated.verified_by,
            updated.requested_bill_id, updated.payment_channel_id,
            updated.billing_definition_id,
            COALESCE(updated.nama_tagihan_snapshot, d.nama) AS billing_name,
            updated.ruang_lingkup, updated.nominal, updated.proof_storage_key,
            updated.submission_type, updated.status, updated.submitted_at,
            updated.review_notified_at, updated.verified_at, updated.rejection_reason
     FROM updated
     JOIN mifabot.billing_definitions d ON d.id = updated.billing_definition_id`,
    [paymentId, approve ? "APPROVED" : "REJECTED", verifierId, rejectionReason],
  );
  return mapPayment(result.rows[0]!);
}

export async function getPaymentAllocationsForReversal(
  client: PoolClient,
  paymentId: string,
): Promise<PaymentAllocationSnapshot[]> {
  const result = await client.query<{ bill_id: string; nominal_alokasi: string }>(
    `SELECT pa.bill_id, pa.nominal_alokasi
     FROM mifabot.payment_allocations pa
     JOIN mifabot.bills b ON b.id = pa.bill_id
     WHERE pa.payment_id = $1
     ORDER BY pa.bill_id
     FOR UPDATE OF pa, b`,
    [paymentId],
  );
  return result.rows.map((row) => ({
    billId: row.bill_id,
    nominal: Number(row.nominal_alokasi),
  }));
}

export async function insertPaymentReversal(
  client: PoolClient,
  input: { paymentId: string; reversedBy: string; reason: string },
): Promise<PaymentReversal> {
  const result = await client.query<PaymentReversalRow>(
    `INSERT INTO mifabot.payment_reversals (payment_id, reversed_by, reason)
     VALUES ($1, $2, $3)
     RETURNING id, payment_id, reversed_by, reason, reversed_at`,
    [input.paymentId, input.reversedBy, input.reason],
  );
  return mapPaymentReversal(result.rows[0]!);
}

export async function insertPaymentReversalAllocations(
  client: PoolClient,
  reversalId: string,
  allocations: PaymentAllocationSnapshot[],
): Promise<void> {
  for (const allocation of allocations) {
    await client.query(
      `INSERT INTO mifabot.payment_reversal_allocations (
         reversal_id, bill_id, nominal_alokasi
       ) VALUES ($1, $2, $3)`,
      [reversalId, allocation.billId, allocation.nominal],
    );
  }
}

export async function deletePaymentAllocations(
  client: PoolClient,
  paymentId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM mifabot.payment_allocations WHERE payment_id = $1`,
    [paymentId],
  );
}

export async function refreshBillStatuses(
  client: PoolClient,
  billIds: string[],
): Promise<void> {
  for (const billId of new Set(billIds)) {
    await client.query(`SELECT mifabot.update_bill_status($1::uuid)`, [billId]);
  }
}

export async function cancelApprovedPayment(
  client: PoolClient,
  paymentId: string,
): Promise<Payment> {
  const result = await client.query<PaymentRow>(
    `WITH updated AS (
       UPDATE mifabot.payments
       SET status = 'CANCELLED'::mifabot.status_pembayaran
       WHERE id = $1
       RETURNING *
     )
     SELECT updated.id, updated.user_id, updated.submitted_by,
            updated.routed_to_admin_id, updated.verified_by,
            updated.requested_bill_id, updated.payment_channel_id,
            updated.billing_definition_id,
            COALESCE(updated.nama_tagihan_snapshot, d.nama) AS billing_name,
            updated.ruang_lingkup, updated.nominal, updated.proof_storage_key,
            updated.submission_type, updated.status, updated.submitted_at,
            updated.verified_at, updated.rejection_reason
     FROM updated
     JOIN mifabot.billing_definitions d ON d.id = updated.billing_definition_id`,
    [paymentId],
  );
  return mapPayment(result.rows[0]!);
}

export async function insertPaymentAuditLog(
  client: PoolClient,
  input: {
    actorUserId: string | null;
    action: string;
    paymentId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO mifabot.audit_logs (
       actor_user_id, action, entity_type, entity_id, old_data, new_data
     ) VALUES ($1, $2, 'PAYMENT', $3, $4::jsonb, $5::jsonb)`,
    [
      input.actorUserId,
      input.action,
      input.paymentId,
      input.oldData ? JSON.stringify(input.oldData) : null,
      input.newData ? JSON.stringify(input.newData) : null,
    ],
  );
}
