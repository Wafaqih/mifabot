export interface StudentImportRow {
  fullName: string;
  username: string;
  phoneNumber: string;
  gender: "L" | "P";
}

export interface StudentImportResult {
  createdStudents: number;
  updatedStudents: number;
}

export class StudentImportValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(
      [
        "File Excel tidak dapat diimpor.",
        ...errors.slice(0, 10).map((error) => `• ${error}`),
        errors.length > 10 ? `• dan ${errors.length - 10} kesalahan lainnya.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    this.name = "StudentImportValidationError";
  }
}
