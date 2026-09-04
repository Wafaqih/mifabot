import ExcelJS from "exceljs";

import {
  StudentImportValidationError,
  type StudentImportRow,
} from "./student-import.types.js";

const requiredColumns = {
  fullName: "Nama Lengkap",
  username: "Username",
  phoneNumber: "Nomor Whatsapp",
  gender: "Jenis Kelamin",
} as const;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function parsePhoneNumber(value: unknown): string | null {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("0")) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith("8")) {
    digits = `62${digits}`;
  }

  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

function parseGender(value: unknown): "L" | "P" | null {
  const normalized = normalizeHeader(value);
  if (["l", "laki", "lakilaki"].includes(normalized)) return "L";
  if (["p", "perempuan", "wanita"].includes(normalized)) return "P";
  return null;
}

function cellValue(cell: ExcelJS.Cell): unknown {
  if (typeof cell.value === "object" && cell.value !== null && "result" in cell.value) {
    return cell.value.result;
  }
  return cell.value;
}

export async function parseStudentImportWorkbook(
  buffer: Buffer | Promise<Buffer>,
): Promise<StudentImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  const resolvedBuffer = await Promise.resolve(buffer);
  const excelBuffer = Buffer.isBuffer(resolvedBuffer)
    ? resolvedBuffer
    : Buffer.from(resolvedBuffer);

  await workbook.xlsx.load(
    excelBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new StudentImportValidationError(["Workbook tidak memiliki sheet."]);
  }

  const headerIndexes = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headerIndexes.set(normalizeHeader(cell.text), columnNumber);
  });
  const missingColumns = Object.values(requiredColumns).filter(
    (column) => !headerIndexes.has(normalizeHeader(column)),
  );
  if (missingColumns.length > 0) {
    throw new StudentImportValidationError([
      `Kolom wajib tidak ditemukan: ${missingColumns.join(", ")}.`,
    ]);
  }

  const errors: string[] = [];
  const students: StudentImportRow[] = [];
  const usernames = new Set<string>();
  const phoneNumbers = new Set<string>();

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const get = (column: string): unknown =>
      cellValue(row.getCell(headerIndexes.get(normalizeHeader(column))!));
    const values = Array.from(headerIndexes.values()).map((column) => row.getCell(column).text.trim());
    if (values.every((value) => value === "")) continue;

    const fullName = text(get(requiredColumns.fullName));
    const username = text(get(requiredColumns.username));
    const phoneNumber = parsePhoneNumber(get(requiredColumns.phoneNumber));
    const gender = parseGender(get(requiredColumns.gender));
    const rowErrors: string[] = [];

    if (!fullName) rowErrors.push("Nama Lengkap wajib diisi");
    if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
      rowErrors.push("Username harus 3-60 karakter alfanumerik, titik, strip, atau underscore");
    }
    if (!phoneNumber) rowErrors.push("Nomor Whatsapp tidak valid");
    if (!gender) rowErrors.push("Jenis Kelamin harus L atau P");

    const usernameKey = username.toLowerCase();
    if (username && usernames.has(usernameKey)) rowErrors.push("Username duplikat di file");
    if (phoneNumber && phoneNumbers.has(phoneNumber)) rowErrors.push("Nomor Whatsapp duplikat di file");

    if (rowErrors.length > 0) {
      errors.push(`Baris ${rowNumber}: ${rowErrors.join("; ")}.`);
      continue;
    }

    usernames.add(usernameKey);
    phoneNumbers.add(phoneNumber!);
    students.push({ fullName, username, phoneNumber: phoneNumber!, gender: gender! });
  }

  if (students.length === 0 && errors.length === 0) {
    errors.push("Tidak ada data santri pada sheet pertama.");
  }
  if (errors.length > 0) throw new StudentImportValidationError(errors);

  return students;
}
