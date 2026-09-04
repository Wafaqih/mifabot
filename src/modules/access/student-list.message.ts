import type { ActiveStudentListItem } from "./access.repository.js";

export function buildStudentListMessage(
  students: ActiveStudentListItem[],
): string {
  if (students.length === 0) {
    return ["*DAFTAR SANTRI*", "", "Belum ada santri aktif yang terdaftar."].join(
      "\n",
    );
  }

  const rows = students.map(
    (student, index) =>
      `${index + 1}. ${student.namaLengkap} (${student.username})\n📞 ${student.nomorWhatsapp}`,
  );

  return ["*DAFTAR SANTRI*", "", ...rows].join("\n");
}