import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { parseStudentImportWorkbook } from "../../src/modules/users/student-import.parser.js";
import { StudentImportValidationError } from "../../src/modules/users/student-import.types.js";

const headers = [
  "Nama Lengkap",
  "Username",
  "Nomor Whatsapp",
  "Jenis Kelamin",
];

async function workbookBuffer(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Santri");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("parseStudentImportWorkbook normalizes a student row and local phone number", async () => {
  const students = await parseStudentImportWorkbook(await workbookBuffer([
    headers,
    ["Budi Santoso", "budi", "0812-1000-001", "L"],
  ]));

  assert.deepEqual(students, [{
    fullName: "Budi Santoso",
    username: "budi",
    phoneNumber: "628121000001",
    gender: "L",
  }]);
});

test("parseStudentImportWorkbook rejects invalid rows before import", async () => {
  await assert.rejects(
    () => parseStudentImportWorkbook(workbookBuffer([
      headers,
      ["", "budi", "not-a-phone", "X"],
    ])),
    StudentImportValidationError,
  );
});
