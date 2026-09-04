import { withTransaction } from "../../core/database/pool.js";
import { env } from "../../config/env.js";
import { ensureCurrentBillsForUserInTransaction } from "../billing/billing.service.js";
import { parseStudentImportWorkbook } from "./student-import.parser.js";
import {
  findUserByPhoneNumber,
  findUserByUsername,
  findUserRoleId,
  insertStudent,
  updateStudent,
} from "./student-import.repository.js";
import type { StudentImportResult } from "./student-import.types.js";

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

export async function importStudentsFromWorkbook(
  workbook: Buffer,
  _actorUserId: string | null,
): Promise<StudentImportResult> {
  const students = await parseStudentImportWorkbook(workbook);
  const asOf = currentDateInAppTimezone();

  return withTransaction(async (client) => {
    const userRoleId = await findUserRoleId(client);
    let createdStudents = 0;
    let updatedStudents = 0;

    for (const student of students) {
      const existingUser = await findUserByUsername(client, student.username);
      const phoneOwner = await findUserByPhoneNumber(client, student.phoneNumber);
      if (phoneOwner && phoneOwner.id !== existingUser?.id) {
        throw new Error(
          `Nomor WhatsApp ${student.phoneNumber} sudah digunakan oleh username ${phoneOwner.username}.`,
        );
      }

      let userId: string;
      if (existingUser) {
        if (existingUser.roleCode !== "USER") {
          throw new Error(`Username ${student.username} bukan akun santri.`);
        }
        await updateStudent(client, existingUser.id, student);
        userId = existingUser.id;
        updatedStudents += 1;
      } else {
        userId = await insertStudent(client, userRoleId, student);
        await ensureCurrentBillsForUserInTransaction(client, { userId, asOf });
        createdStudents += 1;
      }

    }

    return { createdStudents, updatedStudents };
  });
}
