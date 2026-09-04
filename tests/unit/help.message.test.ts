import assert from "node:assert/strict";
import test from "node:test";

import { buildHelpMessage } from "../../src/modules/access/help.message.js";

test("buildHelpMessage rejects an unregistered number", () => {
  const message = buildHelpMessage(null);

  assert.match(message, /belum terdaftar/);
  assert.match(message, /\*Daftar\*/);
  assert.match(message, /\*PANDUAN USER\*/);
  assert.match(message, /Cek profil/);
});

test("buildHelpMessage shows only user commands for USER", () => {
  const message = buildHelpMessage("USER");

  assert.match(message, /Hai, kenalin, aku \*Mifabot\* 🤗/);
  assert.match(message, /\*PANDUAN USER\*/);
  assert.match(message, /\*Daftar\*/);
  assert.match(message, /\*PEMBAYARAN & CICILAN\*/);
  assert.match(message, /Bayar <nama tagihan> lunas/);
  assert.match(message, /\*PEMBAYARAN TUNGGAKAN\*/);
  assert.match(message, /Bayar tunggakan <nama tagihan>/);
  assert.match(message, /Help \/ Bot \/ Panduan \/ Info/);
  assert.match(message, /Cek profil/);
  assert.match(message, /Edit profile/);
  assert.match(message, /Idgrup \(khusus grup\)/);
  assert.match(message, /6283824635228 \(Wafaqih\)/);
  assert.match(message, /ᴍɪꜰᴀʙᴏᴛ/);
  assert.doesNotMatch(message, /\*PANDUAN ADMIN\*/);
  assert.doesNotMatch(message, /\*PANDUAN SUPER ADMIN\*/);
});

test("buildHelpMessage includes admin commands for ADMIN", () => {
  const message = buildHelpMessage("ADMIN");

  assert.match(message, /\*PANDUAN USER\*/);
  assert.match(message, /\*PANDUAN ADMIN\*/);
  assert.match(message, /List santri/);
  assert.match(message, /Bayar <nama tagihan> \[nominal\|lunas\]/);
  assert.match(message, /Reminder <nama tagihan>/);
  assert.match(message, /Reminder grup <nama tagihan>/);
  assert.match(message, /Acc \/ Setujui \/ Ok/);
  assert.match(message, /\*CATAT BAYAR & CICILAN\*/);
  assert.match(message, /Catat bayar <nama tagihan> <santri> lunas/);
  assert.match(message, /Laporan pembayaran <nama tagihan> \[YYYY-MM\]/);
  assert.match(message, /Export tunggakan <nama tagihan>/);
  assert.doesNotMatch(message, /\*PANDUAN SUPER ADMIN\*/);
  assert.doesNotMatch(message, /Set reminder <nama tagihan>/);
  assert.doesNotMatch(message, /Buat tagihan/);
});

test("buildHelpMessage includes super-admin commands for SUPER_ADMIN", () => {
  const message = buildHelpMessage("SUPER_ADMIN");

  assert.match(message, /\*PANDUAN USER\*/);
  assert.match(message, /\*PANDUAN ADMIN\*/);
  assert.match(message, /\*PANDUAN SUPER ADMIN\*/);
  assert.match(message, /List santri/);
  assert.match(message, /Daftar Tagihan/);
  assert.match(message, /Buat tagihan <nama>/);
  assert.match(message, /Hapus tagihan <nama tagihan>/);
  assert.match(message, /Add PJ <nama tagihan>/);
  assert.match(message, /Set nominal <nama tagihan>/);
  assert.match(message, /Reminder <nama tagihan>/);
  assert.match(message, /Set reminder <nama tagihan> H-7 H-3 H-0 atau off/);
  assert.match(message, /Hubungkan grup reminder <id grup>/);
  assert.match(message, /Terbitkan tagihan <nama custom>/);
  assert.match(message, /Tambah metode <nama tagihan> <PJ>/);
  assert.match(message, /Lihat metode <nama tagihan>/);
});
