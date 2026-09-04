import { databasePool, withTransaction } from "../../core/database/pool.js";

import type { UserRole } from "./help.message.js";
import { normalizeWhatsAppNumber } from "./access.service.js";

export interface ActiveUser {
  id: string;
  role: UserRole;
  namaLengkap: string;
  username: string;
  jenisKelamin: "L" | "P";
  nomorWhatsapp: string;
  billingRates: Array<{
    billingDefinitionId: string;
    billingName: string;
    nominal: number;
  }>;
}

export interface ActiveStudentListItem {
  namaLengkap: string;
  username: string;
  nomorWhatsapp: string;
}

export type AdminUnitCode =
  | "BENDAHARA_1"
  | "BENDAHARA_2"
  | "PENDIDIKAN_1"
  | "PENDIDIKAN_2"
  | "KESEJAHTERAAN_1"
  | "KESEJAHTERAAN_2";

interface ActiveUserRow {
  id: string;
  kode: UserRole;
  nama_lengkap: string;
  username: string;
  jenis_kelamin: "L" | "P";
  nomor_whatsapp: string;
}

async function findActiveBillingRates(userId: string): Promise<
  ActiveUser["billingRates"]
> {
  const result = await databasePool.query<{
    billing_definition_id: string;
    billing_name: string;
    nominal: string;
  }>(
    `SELECT d.id AS billing_definition_id, d.nama AS billing_name,
            COALESCE(o.nominal, r.nominal) AS nominal
     FROM mifabot.billing_definitions d
     LEFT JOIN LATERAL (
       SELECT nominal
       FROM mifabot.billing_definition_rates r
       WHERE r.billing_definition_id = d.id
         AND r.berlaku_mulai <= CURRENT_DATE
         AND (r.berlaku_sampai IS NULL OR r.berlaku_sampai >= CURRENT_DATE)
       ORDER BY r.berlaku_mulai DESC
       LIMIT 1
     ) r ON true
     LEFT JOIN LATERAL (
       SELECT nominal
       FROM mifabot.student_billing_overrides o
       WHERE o.billing_definition_id = d.id
         AND o.user_id = $1
         AND o.berlaku_mulai <= CURRENT_DATE
         AND (o.berlaku_sampai IS NULL OR o.berlaku_sampai >= CURRENT_DATE)
       ORDER BY o.berlaku_mulai DESC
       LIMIT 1
     ) o ON true
     WHERE d.is_active AND COALESCE(o.nominal, r.nominal) IS NOT NULL
     ORDER BY LOWER(d.nama), d.id`,
    [userId],
  );
  return result.rows.map((row) => ({
    billingDefinitionId: row.billing_definition_id,
    billingName: row.billing_name,
    nominal: Number(row.nominal),
  }));
}

export async function findActiveUserByWhatsAppNumber(
  phoneNumber: string,
): Promise<ActiveUser | null> {
  const normalizedPhone = normalizeWhatsAppNumber(phoneNumber);
  if (!normalizedPhone) return null;

  const result = await databasePool.query<ActiveUserRow>(
    `SELECT u.id, r.kode, u.nama_lengkap, u.username, u.jenis_kelamin, u.nomor_whatsapp
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.nomor_whatsapp = $1
       AND u.status = 'AKTIF'
       AND r.kode IN ('USER', 'ADMIN', 'SUPER_ADMIN')
     LIMIT 1`,
    [normalizedPhone],
  );

  const user = result.rows[0];
  if (!user) return null;
  return {
    id: user.id,
    role: user.kode,
    namaLengkap: user.nama_lengkap,
    username: user.username,
    jenisKelamin: user.jenis_kelamin,
    nomorWhatsapp: user.nomor_whatsapp,
    billingRates: await findActiveBillingRates(user.id),
  };
}

export async function findActiveUserByIdentifier(
  identifier: string,
): Promise<ActiveUser | null> {
  const value = identifier.trim().replace(/^@/, "");
  if (!value) return null;

  const normalizedPhone = normalizeWhatsAppNumber(value);
  const phoneCondition = normalizedPhone
    ? "OR u.nomor_whatsapp = $2"
    : "";
  const queryValues = normalizedPhone ? [value, normalizedPhone] : [value];
  const result = await databasePool.query<ActiveUserRow>(
    `SELECT u.id, r.kode, u.nama_lengkap, u.username, u.jenis_kelamin, u.nomor_whatsapp
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.status = 'AKTIF'
       AND r.kode IN ('USER', 'ADMIN', 'SUPER_ADMIN')
       AND (LOWER(u.username) = LOWER($1) ${phoneCondition})
     LIMIT 1`,
    queryValues,
  );

  const user = result.rows[0];
  if (!user) return null;

  return {
    id: user.id,
    role: user.kode,
    namaLengkap: user.nama_lengkap,
    username: user.username,
    jenisKelamin: user.jenis_kelamin,
    nomorWhatsapp: user.nomor_whatsapp,
    billingRates: await findActiveBillingRates(user.id),
  };
}

export async function findActiveUserRoleByWhatsAppNumber(
  phoneNumber: string,
): Promise<UserRole | null> {
  const user = await findActiveUserByWhatsAppNumber(phoneNumber);
  return user?.role ?? null;
}

export async function listActiveStudents(): Promise<
  ActiveStudentListItem[]
> {
  const result = await databasePool.query<{
    nama_lengkap: string;
    username: string;
    nomor_whatsapp: string;
  }>(
    `SELECT u.nama_lengkap, u.username, u.nomor_whatsapp
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.status = 'AKTIF'
       AND r.kode = 'USER'
     ORDER BY LOWER(u.nama_lengkap), LOWER(u.username), u.id`,
  );

  return result.rows.map((student) => ({
    namaLengkap: student.nama_lengkap,
    username: student.username,
    nomorWhatsapp: student.nomor_whatsapp,
  }));
}

export async function setAdminUnitAssignment(
  unitCode: AdminUnitCode,
  identifier: string,
): Promise<{ userId: string; username: string; unitCode: AdminUnitCode }> {
  const target = await findActiveUserByIdentifier(identifier);
  if (!target) {
    throw new Error("User tidak ditemukan atau belum aktif.");
  }

  const assignment: Record<AdminUnitCode, "BENDAHARA" | "PENDIDIKAN" | "KESEJAHTERAAN"> = {
    BENDAHARA_1: "BENDAHARA",
    BENDAHARA_2: "BENDAHARA",
    PENDIDIKAN_1: "PENDIDIKAN",
    PENDIDIKAN_2: "PENDIDIKAN",
    KESEJAHTERAAN_1: "KESEJAHTERAAN",
    KESEJAHTERAAN_2: "KESEJAHTERAAN",
  };

  return withTransaction(async (client) => {
    const adminRole = await client.query<{ id: string }>(
      `SELECT id FROM mifabot.roles WHERE kode = 'ADMIN' LIMIT 1`,
    );
    if (adminRole.rows[0]) {
      await client.query(
        `UPDATE mifabot.users
         SET role_id = $2, updated_at = now()
         WHERE id = $1
           AND role_id = (SELECT id FROM mifabot.roles WHERE kode = 'USER' LIMIT 1)`,
        [target.id, adminRole.rows[0].id],
      );
    }

    await client.query(
      `UPDATE mifabot.admin_assignments
       SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND is_active`,
      [target.id],
    );

    const result = await client.query<{ id: string }>(
      `INSERT INTO mifabot.admin_assignments (
         user_id, jenis_penugasan, jenis_kelamin, unit_kode, is_active
       ) VALUES ($1, $2::mifabot.jenis_penugasan_admin, $3::mifabot.jenis_kelamin, $4, true)
       RETURNING id`,
      [
        target.id,
        assignment[unitCode],
        target.jenisKelamin,
        unitCode,
      ],
    );

    return {
      userId: target.id,
      username: target.username,
      unitCode,
    };
  });
}

export async function listAdminAssignments(): Promise<
  Array<{ unitCode: AdminUnitCode; username: string | null; nomorWhatsapp: string | null; namaLengkap: string | null }>
> {
  const result = await databasePool.query<{
    unit_kode: string;
    username: string | null;
    nomor_whatsapp: string | null;
    nama_lengkap: string | null;
  }>(
    `SELECT aa.unit_kode, u.username, u.nomor_whatsapp, u.nama_lengkap
     FROM mifabot.admin_assignments aa
     LEFT JOIN mifabot.users u ON u.id = aa.user_id
     WHERE aa.is_active
     ORDER BY aa.unit_kode`,
  );

  return result.rows.map((r) => ({
    unitCode: r.unit_kode as AdminUnitCode,
    username: r.username,
    nomorWhatsapp: r.nomor_whatsapp,
    namaLengkap: r.nama_lengkap,
  }));
}

export async function getAdminAssignmentByUnit(
  unitCode: AdminUnitCode,
): Promise<{ userId: string | null; username: string | null; nomorWhatsapp: string | null; namaLengkap: string | null } | null> {
  const result = await databasePool.query<{
    user_id: string | null;
    username: string | null;
    nomor_whatsapp: string | null;
    nama_lengkap: string | null;
  }>(
    `SELECT aa.user_id, u.username, u.nomor_whatsapp, u.nama_lengkap
     FROM mifabot.admin_assignments aa
     LEFT JOIN mifabot.users u ON u.id = aa.user_id
     WHERE aa.is_active AND aa.unit_kode = $1
     ORDER BY aa.created_at DESC
     LIMIT 1`,
    [unitCode],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    nomorWhatsapp: row.nomor_whatsapp,
    namaLengkap: row.nama_lengkap,
  };
}
