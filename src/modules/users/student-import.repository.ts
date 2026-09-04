import type { PoolClient } from "pg";

import type { StudentImportRow } from "./student-import.types.js";

interface ExistingUser {
  id: string;
  roleCode: string;
  phoneNumber: string;
}

export async function findUserRoleId(client: PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM mifabot.roles WHERE kode = 'USER'`,
  );
  const roleId = result.rows[0]?.id;
  if (!roleId) throw new Error("Role USER tidak ditemukan.");
  return roleId;
}

export async function findUserByUsername(
  client: PoolClient,
  username: string,
): Promise<ExistingUser | null> {
  const result = await client.query<{
    id: string;
    role_code: string;
    nomor_whatsapp: string;
  }>(
    `SELECT u.id, r.kode AS role_code, u.nomor_whatsapp
     FROM mifabot.users u
     JOIN mifabot.roles r ON r.id = u.role_id
     WHERE u.username = $1
     FOR UPDATE OF u`,
    [username],
  );
  const user = result.rows[0];
  return user
    ? { id: user.id, roleCode: user.role_code, phoneNumber: user.nomor_whatsapp }
    : null;
}

export async function findUserByPhoneNumber(
  client: PoolClient,
  phoneNumber: string,
): Promise<{ id: string; username: string } | null> {
  const result = await client.query<{ id: string; username: string }>(
    `SELECT id, username FROM mifabot.users WHERE nomor_whatsapp = $1 FOR UPDATE`,
    [phoneNumber],
  );
  return result.rows[0] ?? null;
}

export async function insertStudent(
  client: PoolClient,
  userRoleId: string,
  student: StudentImportRow,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO mifabot.users (
       role_id, nama_lengkap, username, jenis_kelamin, nomor_whatsapp, status
     ) VALUES ($1, $2, $3, $4::mifabot.jenis_kelamin, $5, 'AKTIF')
     RETURNING id`,
    [userRoleId, student.fullName, student.username, student.gender, student.phoneNumber],
  );
  return result.rows[0]!.id;
}

export async function updateStudent(
  client: PoolClient,
  userId: string,
  student: StudentImportRow,
): Promise<void> {
  await client.query(
    `UPDATE mifabot.users
     SET nama_lengkap = $2,
         jenis_kelamin = $3::mifabot.jenis_kelamin,
         nomor_whatsapp = $4
     WHERE id = $1`,
    [userId, student.fullName, student.gender, student.phoneNumber],
  );
}
