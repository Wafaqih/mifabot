import type { ActiveUser } from "./access.repository.js";

function greeting(user: Pick<ActiveUser, "username" | "jenisKelamin">): string {
  return `Assalamu'alaikum ${user.jenisKelamin === "L" ? "Mang" : "Teh"} ${user.username}!`;
}

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

export function buildProfileMessage(user: ActiveUser): string {
  const gender = user.jenisKelamin === "L" ? "Laki-laki" : "Perempuan";
  const tariffRows = user.billingRates.map(
    (rate) => `${rate.billingName.padEnd(14)}: ${formatRupiah(rate.nominal)}`,
  );

  return [
    greeting(user),
    "",
    "*PROFIL*",
    "",
    `Nama          : ${user.namaLengkap}`,
    `Username      : ${user.username}`,
    `Nomor WhatsApp: ${user.nomorWhatsapp}`,
    `Jenis Kelamin : ${gender}`,
    "",
    "*NOMINAL TAGIHAN AKTIF*",
    ...(tariffRows.length > 0
      ? tariffRows
      : ["Belum ada tagihan aktif untuk pengguna ini."]),
  ].join("\n");
}
