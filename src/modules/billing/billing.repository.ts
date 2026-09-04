import type { Pool, PoolClient } from "pg";

import type {
  Bill,
  BillPeriod,
  BillFilter,
  BillingDefinition,
  BillingInterval,
  BillingRate,
  BillingResponsible,
  CreateBillInput,
  GenerateBillsInput,
} from "./billing.types.js";

type DatabaseExecutor = Pool | PoolClient;

interface BillRow {
  id: string;
  user_id: string;
  billing_definition_id: string;
  billing_name: string;
  tariff_id: string | null;
  periode_mulai: string;
  periode_selesai: string;
  jatuh_tempo: string;
  nominal: string;
  status: Bill["status"];
  total_dibayar: string;
  sisa: string;
}

interface DefinitionRow {
  id: string;
  kode: string;
  nama: string;
  interval: BillingInterval;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface RateRow {
  id: string;
  billing_definition_id: string;
  user_id: string | null;
  nominal: string;
  berlaku_mulai: string;
  berlaku_sampai: string | null;
}

function mapBill(row: BillRow): Bill {
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

function mapDefinition(row: DefinitionRow): BillingDefinition {
  return {
    id: row.id,
    code: row.kode,
    name: row.nama,
    interval: row.interval,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRate(row: RateRow): BillingRate {
  return {
    id: row.id,
    billingDefinitionId: row.billing_definition_id,
    userId: row.user_id,
    nominal: Number(row.nominal),
    berlakuMulai: row.berlaku_mulai,
    berlakuSampai: row.berlaku_sampai,
  };
}

const billSelect = `
  SELECT
    b.id,
    b.user_id,
    b.billing_definition_id,
    COALESCE(b.nama_tagihan_snapshot, bd.nama) AS billing_name,
    b.tariff_id,
    b.periode_mulai,
    b.periode_selesai,
    b.jatuh_tempo,
    b.nominal,
    b.status,
    COALESCE(SUM(pa.nominal_alokasi), 0) AS total_dibayar,
    b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) AS sisa
  FROM mifabot.bills b
  JOIN mifabot.billing_definitions bd ON bd.id = b.billing_definition_id
  LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
`;

export async function findCurrentBills(
  executor: DatabaseExecutor,
  filter: BillFilter,
): Promise<Bill[]> {
  const values: unknown[] = [
    filter.userId,
    filter.asOf ?? new Date().toISOString().slice(0, 10),
  ];
  const conditions = [
    "b.user_id = $1",
    "b.periode_mulai <= $2::date",
    "b.periode_selesai >= $2::date",
  ];

  if (filter.billingDefinitionId) {
    values.push(filter.billingDefinitionId);
    conditions.push(`b.billing_definition_id = $${values.length}::uuid`);
  }

  const result = await executor.query<BillRow>(
    `${billSelect}
     WHERE ${conditions.join(" AND ")}
     GROUP BY b.id, bd.nama
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.jatuh_tempo, LOWER(COALESCE(b.nama_tagihan_snapshot, bd.nama))`,
    values,
  );

  return result.rows.map(mapBill);
}

export async function findArrears(
  executor: DatabaseExecutor,
  filter: BillFilter,
): Promise<Bill[]> {
  const values: unknown[] = [
    filter.userId,
    filter.asOf ?? new Date().toISOString().slice(0, 10),
  ];
  const conditions = ["b.user_id = $1", "b.periode_selesai < $2::date"];

  if (filter.billingDefinitionId) {
    values.push(filter.billingDefinitionId);
    conditions.push(`b.billing_definition_id = $${values.length}::uuid`);
  }

  const result = await executor.query<BillRow>(
    `${billSelect}
     WHERE ${conditions.join(" AND ")}
     GROUP BY b.id, bd.nama
     HAVING b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) > 0
     ORDER BY b.periode_mulai, LOWER(COALESCE(b.nama_tagihan_snapshot, bd.nama))`,
    values,
  );

  return result.rows.map(mapBill);
}

/**
 * CUSTOM bills have no calendar-derived period.  When a student registers
 * while one is still active, reuse the current period that was issued by the
 * operator so the student immediately receives that active obligation too.
 */
export async function listCurrentIssuedBillPeriods(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  asOf: string,
): Promise<BillPeriod[]> {
  const result = await executor.query<{
    periode_mulai: string;
    periode_selesai: string;
    jatuh_tempo: string;
  }>(
    `SELECT DISTINCT periode_mulai, periode_selesai, jatuh_tempo
     FROM mifabot.bills
     WHERE billing_definition_id = $1
       AND periode_mulai <= $2::date
       AND periode_selesai >= $2::date
     ORDER BY periode_mulai, periode_selesai`,
    [billingDefinitionId, asOf],
  );
  return result.rows.map((row) => ({
    periodeMulai: row.periode_mulai,
    periodeSelesai: row.periode_selesai,
    jatuhTempo: row.jatuh_tempo,
  }));
}

export async function findBillingDefinitionById(
  executor: DatabaseExecutor,
  id: string,
): Promise<BillingDefinition | null> {
  const result = await executor.query<DefinitionRow>(
    `SELECT id, kode, nama, interval, is_active, created_by, created_at, updated_at
     FROM mifabot.billing_definitions
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapDefinition(result.rows[0]) : null;
}

export async function findBillingDefinitionByName(
  executor: DatabaseExecutor,
  name: string,
): Promise<BillingDefinition | null> {
  const result = await executor.query<DefinitionRow>(
    `SELECT id, kode, nama, interval, is_active, created_by, created_at, updated_at
     FROM mifabot.billing_definitions
     WHERE LOWER(btrim(nama)) = LOWER(btrim($1))
     LIMIT 1`,
    [name.trim()],
  );
  return result.rows[0] ? mapDefinition(result.rows[0]) : null;
}

export async function listActiveBillingDefinitions(
  executor: DatabaseExecutor,
): Promise<BillingDefinition[]> {
  const result = await executor.query<DefinitionRow>(
    `SELECT id, kode, nama, interval, is_active, created_by, created_at, updated_at
     FROM mifabot.billing_definitions
     WHERE is_active
     ORDER BY LOWER(nama), id`,
  );
  return result.rows.map(mapDefinition);
}

/**
 * Includes inactive definitions because Super Admin needs to distinguish an
 * operational tagihan from one that has been retired.  The rate is the
 * current global/default rate; student-specific overrides are intentionally
 * excluded from this administrative overview.
 */
export async function listBillingDefinitionsWithCurrentRate(
  executor: DatabaseExecutor,
  asOf: string,
): Promise<Array<{ definition: BillingDefinition; nominal: number | null }>> {
  const result = await executor.query<DefinitionRow & { nominal: string | null }>(
    `SELECT d.id, d.kode, d.nama, d.interval, d.is_active, d.created_by, d.created_at, d.updated_at,
            r.nominal
     FROM mifabot.billing_definitions d
     LEFT JOIN LATERAL (
       SELECT nominal
       FROM mifabot.billing_definition_rates r
       WHERE r.billing_definition_id = d.id
         AND r.berlaku_mulai <= $1::date
         AND (r.berlaku_sampai IS NULL OR r.berlaku_sampai >= $1::date)
       ORDER BY r.berlaku_mulai DESC
       LIMIT 1
     ) r ON true
     ORDER BY LOWER(d.nama), d.id`,
    [asOf],
  );
  return result.rows.map((row) => ({
    definition: mapDefinition(row),
    nominal: row.nominal === null ? null : Number(row.nominal),
  }));
}

export async function definitionCodeExists(
  executor: DatabaseExecutor,
  code: string,
): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM mifabot.billing_definitions WHERE kode = $1) AS exists`,
    [code],
  );
  return result.rows[0]?.exists ?? false;
}

export async function insertBillingDefinition(
  executor: PoolClient,
  input: {
    code: string;
    name: string;
    interval: BillingInterval;
    createdBy: string | null;
  },
): Promise<BillingDefinition> {
  const result = await executor.query<DefinitionRow>(
    `INSERT INTO mifabot.billing_definitions (
       kode, nama, interval, is_active, created_by
     ) VALUES ($1, $2, $3::mifabot.billing_interval, false, $4)
     RETURNING id, kode, nama, interval, is_active, created_by, created_at, updated_at`,
    [input.code, input.name, input.interval, input.createdBy],
  );
  return mapDefinition(result.rows[0]!);
}

export async function activateBillingDefinition(
  executor: PoolClient,
  billingDefinitionId: string,
): Promise<void> {
  await executor.query(
    `UPDATE mifabot.billing_definitions
     SET is_active = true
     WHERE id = $1 AND NOT is_active`,
    [billingDefinitionId],
  );
}

/** Retiring a definition preserves issued bills and their payment audit trail. */
export async function deactivateBillingDefinition(
  executor: PoolClient,
  billingDefinitionId: string,
): Promise<boolean> {
  const result = await executor.query<{ id: string }>(
    `UPDATE mifabot.billing_definitions
     SET is_active = false
     WHERE id = $1 AND is_active
     RETURNING id`,
    [billingDefinitionId],
  );
  return result.rowCount === 1;
}

export async function findRateForPeriod(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  userId: string,
  periodeMulai: string,
): Promise<BillingRate | null> {
  const override = await executor.query<RateRow>(
    `SELECT id, billing_definition_id, user_id, nominal, berlaku_mulai, berlaku_sampai
     FROM mifabot.student_billing_overrides
     WHERE billing_definition_id = $1
       AND user_id = $2
       AND berlaku_mulai <= $3::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $3::date)
     ORDER BY berlaku_mulai DESC
     LIMIT 1`,
    [billingDefinitionId, userId, periodeMulai],
  );
  if (override.rows[0]) return mapRate(override.rows[0]);

  const baseRate = await executor.query<RateRow>(
    `SELECT id, billing_definition_id, NULL::uuid AS user_id, nominal, berlaku_mulai, berlaku_sampai
     FROM mifabot.billing_definition_rates
     WHERE billing_definition_id = $1
       AND berlaku_mulai <= $2::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $2::date)
     ORDER BY berlaku_mulai DESC
     LIMIT 1`,
    [billingDefinitionId, periodeMulai],
  );
  return baseRate.rows[0] ? mapRate(baseRate.rows[0]) : null;
}

export async function listEffectiveRatesForUser(
  executor: DatabaseExecutor,
  userId: string,
  asOf: string,
): Promise<Array<{ definition: BillingDefinition; nominal: number }>> {
  const result = await executor.query<DefinitionRow & { nominal: string | null }>(
    `SELECT d.id, d.kode, d.nama, d.interval, d.is_active, d.created_by, d.created_at, d.updated_at,
            COALESCE(o.nominal, r.nominal) AS nominal
     FROM mifabot.billing_definitions d
     LEFT JOIN LATERAL (
       SELECT nominal
       FROM mifabot.billing_definition_rates r
       WHERE r.billing_definition_id = d.id
         AND r.berlaku_mulai <= $2::date
         AND (r.berlaku_sampai IS NULL OR r.berlaku_sampai >= $2::date)
       ORDER BY r.berlaku_mulai DESC
       LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT nominal
       FROM mifabot.student_billing_overrides o
       WHERE o.billing_definition_id = d.id
         AND o.user_id = $1
         AND o.berlaku_mulai <= $2::date
         AND (o.berlaku_sampai IS NULL OR o.berlaku_sampai >= $2::date)
       ORDER BY o.berlaku_mulai DESC
       LIMIT 1
     ) o ON true
     WHERE d.is_active
       AND COALESCE(o.nominal, r.nominal) IS NOT NULL
     ORDER BY LOWER(d.nama), d.id`,
    [userId, asOf],
  );
  return result.rows.map((row) => ({
    definition: mapDefinition(row),
    nominal: Number(row.nominal),
  }));
}

export async function findActiveUsersForDefinition(
  executor: DatabaseExecutor,
  input: GenerateBillsInput,
): Promise<string[]> {
  const values: unknown[] = [];
  // A recurring definition applies to active students.  An ADMIN who happens
  // to be responsible for a bill must never receive that bill merely because
  // they are an active account.
  const conditions = ["u.status = 'AKTIF'", "role.kode = 'USER'"];
  if (input.userId) {
    values.push(input.userId);
    conditions.push(`u.id = $${values.length}::uuid`);
  }
  const result = await executor.query<{ id: string }>(
    `SELECT u.id
     FROM mifabot.users u
     JOIN mifabot.roles role ON role.id = u.role_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY LOWER(u.username), u.id`,
    values,
  );
  return result.rows.map((row) => row.id);
}

export async function insertBill(
  executor: PoolClient,
  input: CreateBillInput,
  definition: BillingDefinition,
  rate: BillingRate,
): Promise<Bill> {
  const result = await executor.query<BillRow>(
    `INSERT INTO mifabot.bills (
       user_id, billing_definition_id, nama_tagihan_snapshot,
       periode_mulai, periode_selesai, jatuh_tempo, nominal, status
     ) VALUES ($1, $2, $3, $4::date, $5::date, $6::date, $7, 'BELUM_BAYAR')
     ON CONFLICT (user_id, billing_definition_id, periode_mulai, periode_selesai) DO NOTHING
     RETURNING id, user_id, billing_definition_id, nama_tagihan_snapshot AS billing_name,
       tariff_id, periode_mulai, periode_selesai, jatuh_tempo, nominal, status,
       0::bigint AS total_dibayar, nominal AS sisa`,
    [
      input.userId,
      input.billingDefinitionId,
      definition.name,
      input.periodeMulai,
      input.periodeSelesai,
      input.jatuhTempo,
      rate.nominal,
    ],
  );
  if (result.rows[0]) return mapBill(result.rows[0]);

  const existing = await executor.query<BillRow>(
    `${billSelect}
     WHERE b.user_id = $1
       AND b.billing_definition_id = $2
       AND b.periode_mulai = $3::date
       AND b.periode_selesai = $4::date
     GROUP BY b.id, bd.nama`,
    [
      input.userId,
      input.billingDefinitionId,
      input.periodeMulai,
      input.periodeSelesai,
    ],
  );
  if (!existing.rows[0]) throw new Error("Tagihan gagal dibuat.");
  return mapBill(existing.rows[0]);
}

export async function closeCurrentBaseRate(
  executor: PoolClient,
  billingDefinitionId: string,
  effectiveDate: string,
): Promise<void> {
  // A new global command supersedes any rate scheduled for a later period.
  // Keeping it would create an overlapping interval once the new rate is
  // opened from `effectiveDate` onward.
  await executor.query(
    `DELETE FROM mifabot.billing_definition_rates
     WHERE billing_definition_id = $1
       AND berlaku_mulai > $2::date`,
    [billingDefinitionId, effectiveDate],
  );
  await executor.query(
    `UPDATE mifabot.billing_definition_rates
     SET berlaku_sampai = ($2::date - INTERVAL '1 day')::date
     WHERE billing_definition_id = $1
       AND berlaku_mulai < $2::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $2::date)`,
    [billingDefinitionId, effectiveDate],
  );
}

export async function upsertBaseRate(
  executor: PoolClient,
  input: {
    billingDefinitionId: string;
    nominal: number;
    effectiveDate: string;
    createdBy: string | null;
  },
): Promise<void> {
  const current = await executor.query<{ id: string; berlaku_mulai: string }>(
    `SELECT id, berlaku_mulai
     FROM mifabot.billing_definition_rates
     WHERE billing_definition_id = $1
       AND berlaku_mulai <= $2::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $2::date)
     ORDER BY berlaku_mulai DESC
     LIMIT 1
     FOR UPDATE`,
    [input.billingDefinitionId, input.effectiveDate],
  );
  if (current.rows[0]?.berlaku_mulai === input.effectiveDate) {
    await executor.query(
      `UPDATE mifabot.billing_definition_rates
       SET nominal = $2, berlaku_sampai = NULL
       WHERE id = $1`,
      [current.rows[0].id, input.nominal],
    );
    await executor.query(
      `DELETE FROM mifabot.billing_definition_rates
       WHERE billing_definition_id = $1
         AND berlaku_mulai > $2::date`,
      [input.billingDefinitionId, input.effectiveDate],
    );
    return;
  }
  await closeCurrentBaseRate(
    executor,
    input.billingDefinitionId,
    input.effectiveDate,
  );
  await executor.query(
    `INSERT INTO mifabot.billing_definition_rates (
       billing_definition_id, nominal, berlaku_mulai, created_by
     ) VALUES ($1, $2, $3::date, $4)`,
    [
      input.billingDefinitionId,
      input.nominal,
      input.effectiveDate,
      input.createdBy,
    ],
  );
}

export async function closeActiveOverrides(
  executor: PoolClient,
  billingDefinitionId: string,
  effectiveDate: string,
  userIds?: string[],
): Promise<void> {
  const values: unknown[] = [billingDefinitionId, effectiveDate];
  let userCondition = "";
  if (userIds && userIds.length > 0) {
    values.push(userIds);
    userCondition = ` AND user_id = ANY($${values.length}::uuid[])`;
  }
  await executor.query(
    `UPDATE mifabot.student_billing_overrides
     SET berlaku_sampai = ($2::date - INTERVAL '1 day')::date
     WHERE billing_definition_id = $1
       AND berlaku_mulai < $2::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $2::date)${userCondition}`,
    values,
  );
  // Rows that start on or after the new effective date are planned overrides
  // rather than history.  They must be removed so `Semua` really restores the
  // global nominal for every future period and an override can be replaced.
  const futureValues: unknown[] = [billingDefinitionId, effectiveDate];
  let futureUserCondition = "";
  if (userIds && userIds.length > 0) {
    futureValues.push(userIds);
    futureUserCondition = ` AND user_id = ANY($${futureValues.length}::uuid[])`;
  }
  await executor.query(
    `DELETE FROM mifabot.student_billing_overrides
     WHERE billing_definition_id = $1
       AND berlaku_mulai >= $2::date${futureUserCondition}`,
    futureValues,
  );
}

export async function upsertStudentOverride(
  executor: PoolClient,
  input: {
    billingDefinitionId: string;
    userId: string;
    nominal: number;
    effectiveDate: string;
    createdBy: string | null;
  },
): Promise<void> {
  const current = await executor.query<{ id: string; berlaku_mulai: string }>(
    `SELECT id, berlaku_mulai
     FROM mifabot.student_billing_overrides
     WHERE billing_definition_id = $1
       AND user_id = $2
       AND berlaku_mulai <= $3::date
       AND (berlaku_sampai IS NULL OR berlaku_sampai >= $3::date)
     ORDER BY berlaku_mulai DESC
     LIMIT 1
     FOR UPDATE`,
    [input.billingDefinitionId, input.userId, input.effectiveDate],
  );
  if (current.rows[0]?.berlaku_mulai === input.effectiveDate) {
    await executor.query(
      `UPDATE mifabot.student_billing_overrides
       SET nominal = $2, berlaku_sampai = NULL
       WHERE id = $1`,
      [current.rows[0].id, input.nominal],
    );
    await executor.query(
      `DELETE FROM mifabot.student_billing_overrides
       WHERE billing_definition_id = $1
         AND user_id = $2
         AND berlaku_mulai > $3::date`,
      [input.billingDefinitionId, input.userId, input.effectiveDate],
    );
    return;
  }
  await closeActiveOverrides(
    executor,
    input.billingDefinitionId,
    input.effectiveDate,
    [input.userId],
  );
  await executor.query(
    `INSERT INTO mifabot.student_billing_overrides (
       billing_definition_id, user_id, nominal, berlaku_mulai, created_by
     ) VALUES ($1, $2, $3, $4::date, $5)`,
    [
      input.billingDefinitionId,
      input.userId,
      input.nominal,
      input.effectiveDate,
      input.createdBy,
    ],
  );
}

export async function listBillingResponsibles(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
): Promise<BillingResponsible[]> {
  const result = await executor.query<{
    id: string;
    billing_definition_id: string;
    user_id: string;
    username: string;
    nama_lengkap: string;
    nomor_whatsapp: string;
    is_active: boolean;
  }>(
    `SELECT r.id, r.billing_definition_id, r.user_id, u.username,
            u.nama_lengkap, u.nomor_whatsapp, r.is_active
     FROM mifabot.billing_definition_responsibles r
     JOIN mifabot.users u ON u.id = r.user_id
     WHERE r.billing_definition_id = $1 AND r.is_active
     ORDER BY LOWER(u.username), u.id`,
    [billingDefinitionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    billingDefinitionId: row.billing_definition_id,
    userId: row.user_id,
    username: row.username,
    namaLengkap: row.nama_lengkap,
    nomorWhatsapp: row.nomor_whatsapp,
    isActive: row.is_active,
  }));
}

/** True only while both the definition and its PJ assignment are active. */
export async function isActiveBillingResponsible(
  executor: DatabaseExecutor,
  billingDefinitionId: string,
  userId: string,
): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1
       FROM mifabot.billing_definition_responsibles r
       JOIN mifabot.billing_definitions d
         ON d.id = r.billing_definition_id
       JOIN mifabot.users u ON u.id = r.user_id
       WHERE r.billing_definition_id = $1
         AND r.user_id = $2
         AND r.is_active
         AND d.is_active
         AND u.status = 'AKTIF'
     ) AS exists`,
    [billingDefinitionId, userId],
  );
  return result.rows[0]?.exists ?? false;
}

export async function addBillingResponsible(
  executor: PoolClient,
  billingDefinitionId: string,
  userId: string,
): Promise<void> {
  const existing = await executor.query<{ id: string }>(
    `SELECT id FROM mifabot.billing_definition_responsibles
     WHERE billing_definition_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [billingDefinitionId, userId],
  );
  if (existing.rows[0]) {
    await executor.query(
      `UPDATE mifabot.billing_definition_responsibles
       SET is_active = true
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await executor.query(
    `INSERT INTO mifabot.billing_definition_responsibles (
       billing_definition_id, user_id, is_active
     ) VALUES ($1, $2, true)`,
    [billingDefinitionId, userId],
  );
}

export async function deactivateBillingResponsible(
  executor: PoolClient,
  billingDefinitionId: string,
  userId: string,
): Promise<boolean> {
  const result = await executor.query(
    `UPDATE mifabot.billing_definition_responsibles
     SET is_active = false
     WHERE billing_definition_id = $1 AND user_id = $2 AND is_active`,
    [billingDefinitionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countActiveBillingResponsibles(
  executor: PoolClient,
  billingDefinitionId: string,
): Promise<number> {
  const result = await executor.query<{ id: string }>(
    `SELECT id
     FROM mifabot.billing_definition_responsibles
     WHERE billing_definition_id = $1 AND is_active
     FOR UPDATE`,
    [billingDefinitionId],
  );
  return result.rows.length;
}

export async function promoteUserToAdmin(
  executor: PoolClient,
  userId: string,
): Promise<void> {
  await executor.query(
    `UPDATE mifabot.users
     SET role_id = (SELECT id FROM mifabot.roles WHERE kode = 'ADMIN' LIMIT 1)
     WHERE id = $1
       AND role_id = (SELECT id FROM mifabot.roles WHERE kode = 'USER' LIMIT 1)`,
    [userId],
  );
}

export async function listActiveUsersByIds(
  executor: DatabaseExecutor,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const result = await executor.query<{ id: string }>(
    `SELECT id FROM mifabot.users
     WHERE id = ANY($1::uuid[]) AND status = 'AKTIF'`,
    [userIds],
  );
  return result.rows.map((row) => row.id);
}

/** Return only active santri.  PJ assignment deliberately uses the broader
 * active-user lookup above because an existing ADMIN or SUPER_ADMIN may also
 * be made responsible for a bill. */
export async function listActiveStudentsByIds(
  executor: DatabaseExecutor,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const result = await executor.query<{ id: string }>(
    `SELECT u.id
     FROM mifabot.users u
     JOIN mifabot.roles role ON role.id = u.role_id
     WHERE u.id = ANY($1::uuid[])
       AND u.status = 'AKTIF'
       AND role.kode = 'USER'`,
    [userIds],
  );
  return result.rows.map((row) => row.id);
}
