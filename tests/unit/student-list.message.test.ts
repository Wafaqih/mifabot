import assert from "node:assert/strict";
import test from "node:test";

import { buildStudentListMessage } from "../../src/modules/access/student-list.message.js";

test("buildStudentListMessage formats numbered student contacts", () => {
  const message = buildStudentListMessage([
    {
      namaLengkap: "Budi Santoso",
      username: "budi",
      nomorWhatsapp: "6282123456789",
    },
    {
      namaLengkap: "Sri Mulyanti",
      username: "sri.mulyanti",
      nomorWhatsapp: "6282123456789",
    },
  ]);

  assert.equal(
    message,
    [
      "*DAFTAR SANTRI*",
      "",
      "1. Budi Santoso (budi)",
      "📞 6282123456789",
      "2. Sri Mulyanti (sri.mulyanti)",
      "📞 6282123456789",
    ].join("\n"),
  );
});

test("buildStudentListMessage explains an empty active-student list", () => {
  assert.equal(
    buildStudentListMessage([]),
    ["*DAFTAR SANTRI*", "", "Belum ada santri aktif yang terdaftar."].join("\n"),
  );
});