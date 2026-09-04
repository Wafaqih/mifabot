export type UserRole = "USER" | "ADMIN" | "SUPER_ADMIN";

function formatCommandList(commands: string[]): string {
  return commands.map((command) => `• *${command}*`).join("\n");
}

const userGuide = [
  "*PANDUAN USER*",
  formatCommandList([
    "Daftar",
    "Help / Bot / Panduan / Info",
    "Cek profil",
    "Edit profile",
    "Cek tagihan",
    "Bayar <nama tagihan> [nominal|lunas]",
    "Bayar tunggakan <nama tagihan>",
    "Idgrup (khusus grup)",
  ]),
  "",
  "*PEMBAYARAN & CICILAN*",
  "• Nominal yang lebih kecil dari sisa tagihan akan dicatat sebagai cicilan.",
  "• Sisa tagihan berkurang setelah pengajuan pembayaran disetujui PJ.",
  "• Gunakan *Bayar <nama tagihan> lunas* untuk membayar seluruh sisa tagihan.",
  "• Gunakan *Cek tagihan* untuk melihat status dan sisa tagihan.",
  "",
  "*PEMBAYARAN TUNGGAKAN*",
  "• Gunakan *Bayar tunggakan <nama tagihan>*, lalu pilih periode tunggakan yang akan dibayar.",
  "• Masukkan nominal cicilan atau balas *Lunas* untuk melunasi semua periode yang dipilih.",
  "• Nominal dibagi dari periode tunggakan terlama ke terbaru.",
];

const adminGuide = [
  "*PANDUAN ADMIN*",
  formatCommandList([
    "List santri",
    "Buat jadwal",
    "Reminder jadwal <nama kegiatan>",
    "Reminder <nama tagihan>",
    "Reminder grup <nama tagihan>",
    "Catat bayar <nama tagihan> <santri> <nominal|lunas>",
    "Catat tunggakan <nama tagihan> <santri>",
    "List pengajuan",
    "Acc / Setujui / Ok",
    "Tolak <alasan>",
    "Laporan pembayaran <nama tagihan> [YYYY-MM]",
    "Export pembayaran <nama tagihan> [YYYY-MM]",
    "Laporan tunggakan <nama tagihan>",
    "Export tunggakan <nama tagihan>",
    "Audit pembayaran <nama tagihan>",
    "Riwayat pembayaran <nama tagihan>",
    "Reversal <nomor> <alasan>",
  ]),
  "",
  "*CATAT BAYAR & CICILAN*",
  "• Nominal yang lebih kecil dari sisa tagihan akan dicatat sebagai cicilan.",
  "• Gunakan *Catat bayar <nama tagihan> <santri> lunas* untuk mencatat seluruh sisa tagihan santri.",
];

const superAdminGuide = [
  "*PANDUAN SUPER ADMIN*",
  formatCommandList([
    "Data santri",
    "Daftar Tagihan",
    "Buat tagihan <nama> <nominal> <mingguan|bulanan|tahunan|custom>",
    "Hapus tagihan <nama tagihan>",
    "Add PJ <nama tagihan> <username/nomor_whatsapp>",
    "Del PJ <nama tagihan> <username/nomor_whatsapp>",
    "Set nominal <nama tagihan> <nominal>, lalu target per baris atau Semua",
    "Set reminder <nama tagihan> H-7 H-3 H-0 atau off",
    "Hubungkan grup reminder <id grup>",
    "Terbitkan tagihan <nama custom> <YYYY-MM-DD> <YYYY-MM-DD> <YYYY-MM-DD>",
    "Tambah metode <nama tagihan> <PJ>",
    "Lihat metode <nama tagihan>",
    "Ubah metode <nama tagihan> <nomor>",
    "Nonaktifkan metode <nama tagihan> <nomor>",
  ]),
];

const helpIntroduction = [
  "Assalamu'alaikum 👋",
  "",
  "Hai, kenalin, aku *Mifabot* 🤗 Aku siap membantu manajemen santri Miftahul Falah.",
  "",
  "Berikut panduan penggunaan Mifabot:",
];

const helpFooter = [
  "Kritik, saran, atau keluhan? Hubungi pengembang 👉 6283824635228 (Wafaqih)",
  "",
  "───────",
  "ᴍɪꜰᴀʙᴏᴛ",
];

export function buildHelpMessage(role: UserRole | null): string {
  if (!role) {
    return [
      ...helpIntroduction,
      "",
      "Nomor WhatsApp ini belum terdaftar sebagai pengguna aktif Mifabot.",
      "Gunakan *Daftar* untuk melakukan pendaftaran mandiri.",
      "Jika Anda pernah terdaftar atau akun tidak aktif, silakan hubungi admin.",
      "",
      ...userGuide,
      "",
      ...helpFooter,
    ].join("\n");
  }

  const guides = [userGuide];
  if (role === "ADMIN" || role === "SUPER_ADMIN") guides.push(adminGuide);
  if (role === "SUPER_ADMIN") guides.push(superAdminGuide);

  return [
    ...helpIntroduction,
    "",
    ...guides.flatMap((guide, index) => (index === 0 ? guide : ["", ...guide])),
    "",
    ...helpFooter,
  ].join("\n");
}
