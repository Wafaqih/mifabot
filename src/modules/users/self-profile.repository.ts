import type { Pool, PoolClient } from "pg";

import type {
  SelfProfile,
  SelfProfileGender,
  SelfProfileRole,
  SelfProfileStatus,
} from "./self-profile.types.js";

export type SelfProfileDatabaseExecutor = Pool | PoolClient;

interface SelfProfileRow {
  id: string;
  nama_lengkap: string;
  username: string;
  nomor_whatsapp: string;
  jenis_kelamin: SelfProfileGender;
  kode: SelfProfileRole;
  status: SelfProfileStatus;
}

function mapProfile(row: SelfProfileRow): SelfProfile {
  return {
    id: row.id,
    fullName: row.nama_lengkap,
    username: row.username,
    phoneNumber: row.nomor_whatsapp,
    gender: row.jenis_kelamin,
    role: row.kode,
    status: row.status,
  };
}

/**
 * Serialize writes for a normalized identity key.  The database has ordinary
 * unique indexes for the exact values; this additionally prevents a
 * case-variant username from slipping through concurrent self-service calls.
 */
export async function lockSelfProfileIdentity(
  client: PoolClient,
  identity: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [identity],
  );
}

export async function findUserByWhatsAppNumberIncludingInactive(
  executor: SelfProfileDatabaseExecutor,
  phoneNumber: string,
  options: { forUpdate?: boolean } = {},
): Promise<SelfProfile | null> {
  const result = await executor.query<SelfProfileRow>(
    `SELECT u.id, u.nama_lengkap, u.username, u.nomor_whatsapp,
            u.jenis_kelamin, r.kode, u.status
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.nomor_whatsapp = $1
     LIMIT 1${options.forUpdate ? " FOR UPDATE OF u" : ""}`,
    [phoneNumber],
  );

  const user = result.rows[0];
  return user ? mapProfile(user) : null;
}

export async function findUserByUsernameCaseInsensitive(
  executor: SelfProfileDatabaseExecutor,
  username: string,
  options: { forUpdate?: boolean } = {},
): Promise<SelfProfile | null> {
  const result = await executor.query<SelfProfileRow>(
    `SELECT u.id, u.nama_lengkap, u.username, u.nomor_whatsapp,
            u.jenis_kelamin, r.kode, u.status
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER($1)
     LIMIT 1${options.forUpdate ? " FOR UPDATE OF u" : ""}`,
    [username],
  );

  const user = result.rows[0];
  return user ? mapProfile(user) : null;
}

export async function findSelfProfileById(
  client: PoolClient,
  userId: string,
): Promise<SelfProfile | null> {
  const result = await client.query<SelfProfileRow>(
    `SELECT u.id, u.nama_lengkap, u.username, u.nomor_whatsapp,
            u.jenis_kelamin, r.kode, u.status
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.id = $1
     FOR UPDATE OF u`,
    [userId],
  );

  const user = result.rows[0];
  return user ? mapProfile(user) : null;
}

export async function findUserRoleId(
  client: PoolClient,
  role: SelfProfileRole,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM mifabot.roles WHERE kode = $1 LIMIT 1",
    [role],
  );
  const roleId = result.rows[0]?.id;
  if (!roleId) throw new Error(`Role ${role} tidak ditemukan.`);
  return roleId;
}

export async function insertSelfRegisteredUser(
  client: PoolClient,
  input: {
    userRoleId: string;
    fullName: string;
    username: string;
    phoneNumber: string;
    gender: SelfProfileGender;
  },
): Promise<SelfProfile> {
  const result = await client.query<Omit<SelfProfileRow, "kode">>(
    `INSERT INTO mifabot.users (
       role_id, nama_lengkap, username, jenis_kelamin, nomor_whatsapp, status
     ) VALUES ($1, $2, $3, $4::mifabot.jenis_kelamin, $5, 'AKTIF')
     RETURNING id, nama_lengkap, username, nomor_whatsapp, jenis_kelamin, status`,
    [
      input.userRoleId,
      input.fullName,
      input.username,
      input.gender,
      input.phoneNumber,
    ],
  );
  const user = result.rows[0];
  if (!user) throw new Error("Pendaftaran pengguna tidak menghasilkan data.");

  return mapProfile({ ...user, kode: "USER" });
}

export async function updateSelfProfileField(
  client: PoolClient,
  input: {
    userId: string;
    field: "nama_lengkap" | "username" | "nomor_whatsapp" | "jenis_kelamin";
    value: string;
  },
): Promise<SelfProfile | null> {
  // The field name comes from a closed service-side mapping, never raw user
  // input, so interpolating it does not make this query injectable.
  const result = await client.query<SelfProfileRow>(
    `UPDATE mifabot.users u
     SET ${input.field} = $2${input.field === "jenis_kelamin" ? "::mifabot.jenis_kelamin" : ""}
     FROM mifabot.roles r
     WHERE u.id = $1
       AND r.id = u.role_id
     RETURNING u.id, u.nama_lengkap, u.username, u.nomor_whatsapp,
               u.jenis_kelamin, r.kode, u.status`,
    [input.userId, input.value],
  );
  const user = result.rows[0];
  return user ? mapProfile(user) : null;
}
