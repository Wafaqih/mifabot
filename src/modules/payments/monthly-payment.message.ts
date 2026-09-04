import type { Bill } from "../billing/billing.types.js";
import type {
  ApprovedPaymentReview,
  PaymentChannel,
  PendingPaymentReview,
} from "./payment.types.js";

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

function paymentChannelLines(channels: PaymentChannel[]): string[] {
  return channels.map((channel, index) => {
    const details =
      channel.metode === "CASH"
        ? `Cash${channel.instruksi ? ` - ${channel.instruksi}` : ""}`
        : `${channel.metode === "BANK_TRANSFER" ? "Rekening Bank" : "E-Wallet"} - ${channel.nomorRekening ?? "nomor belum diatur"}`;
    return `${index + 1}. ${channel.nama} (${details})`;
  });
}

export function billingPaymentGuide(billingName?: string): string {
  const paymentTarget = billingName ?? "<nama tagihan>";
  return [
    "*CARA BAYAR TAGIHAN*",
    "",
    "Cara 1 — bot meminta nominal:",
    `*Bayar ${paymentTarget}*`,
    "",
    "Cara 2 — langsung sertakan nominal:",
    `*Bayar ${paymentTarget} 65.000*`,
    "",
    "Cara 3 — lunasi seluruh sisa tagihan:",
    `*Bayar ${paymentTarget} lunas*`,
    "",
    "Format nominal: 65000, 65.000, atau 65k.",
    "",
    "Nominal lebih kecil dari sisa tagihan akan dicatat sebagai cicilan.",
    "Nominal sama dengan sisa tagihan akan melunasi tagihan bulan berjalan.",
    "Nominal tidak boleh melebihi sisa tagihan.",
  ].join("\n");
}

export function billingPaymentAmountPrompt(input: {
  billingName: string;
  outstanding: number;
}): string {
  return [
    "*MASUKKAN NOMINAL PEMBAYARAN*",
    "",
    `Tagihan: ${input.billingName}`,
    `Sisa tagihan: ${formatRupiah(input.outstanding)}`,
    "",
    "Balas dengan nominal yang akan dibayar.",
    "Contoh: *65000*, *65.000*, atau *65k*.",
    "Untuk membayar seluruh sisa tagihan, balas *Lunas*.",
  ].join("\n");
}

export function billingPaymentAmountError(billingName?: string): string {
  const paymentTarget = billingName ?? "<nama tagihan>";
  return [
    "Format nominal belum benar.",
    `Contoh command: *Bayar ${paymentTarget} 65.000*`,
    "Atau balas: *65000*, *65.000*, atau *65k*.",
    "Ketik *Lunas* untuk membayar seluruh sisa tagihan.",
    "Nominal harus berupa bilangan bulat positif.",
  ].join("\n");
}

export function billingPaymentChannelChoice(
  bill: Bill,
  nominal: number,
  channels: PaymentChannel[],
): string {
  const paymentType = nominal < bill.sisa ? "cicilan" : "pelunasan";

  return [
    "*KONFIRMASI PEMBAYARAN TAGIHAN*",
    "",
    `Tagihan: ${bill.billingName}`,
    `Nominal: ${formatRupiah(nominal)}`,
    `Jenis: ${paymentType}`,
    `Sisa tagihan: ${formatRupiah(bill.sisa)}`,
    "",
    "Pilih channel pembayaran dengan membalas nomor:",
    ...paymentChannelLines(channels),
  ].join("\n");
}

export function arrearsPaymentGuide(billingName?: string): string {
  return [
    "*CARA BAYAR TUNGGAKAN*",
    "",
    "Pilih nama tagihan yang memiliki tunggakan, misalnya:",
    `*Bayar tunggakan ${billingName ?? "SPP"}*`,
    "",
    "Bot akan menampilkan tunggakan yang dapat dipilih, lalu meminta nominal pembayaran.",
    "Nominal akan dialokasikan dari periode terlama ke terbaru.",
  ].join("\n");
}

export function adminCurrentPaymentGuide(): string {
  return [
    "*CATAT PEMBAYARAN SANTRI*",
    "",
    "PJ aktif dapat mencatat pembayaran bill berjalan milik santri:",
    "*Catat bayar <nama tagihan> <username/nomor WhatsApp> <nominal|lunas>*",
    "",
    "Contoh: Catat bayar SPP ahmad 100.000",
    "Untuk melunasi sisa tagihan santri: Catat bayar SPP ahmad lunas",
    "Pembayaran langsung disetujui dan dialokasikan ke bill santri.",
  ].join("\n");
}

export function adminArrearsPaymentGuide(): string {
  return [
    "*CATAT PEMBAYARAN TUNGGAKAN SANTRI*",
    "",
    "PJ aktif dapat memilih tunggakan milik santri untuk dicatat sebagai pembayaran penuh:",
    "*Catat tunggakan <nama tagihan> <username/nomor WhatsApp>*",
    "",
    "Contoh: Catat tunggakan SPP ahmad",
  ].join("\n");
}

export function arrearsBillSelectionMessage(
  billingName: string,
  bills: Bill[],
): string {
  return [
    "*PILIH TUNGGAKAN*",
    "",
    `Tagihan: ${billingName}`,
    "Balas nomor tunggakan yang ingin dibayar. Pisahkan beberapa nomor dengan koma, misalnya: 1, 3",
    "Setelah itu, masukkan nominal cicilan atau ketik Lunas untuk melunasi pilihan tersebut.",
    "",
    ...bills.map(
      (bill, index) =>
        `${index + 1}. Periode ${bill.periodeMulai} s.d. ${bill.periodeSelesai} — sisa ${formatRupiah(bill.sisa)}`,
    ),
  ].join("\n");
}

export function adminArrearsBillSelectionMessage(
  studentName: string,
  billingName: string,
  bills: Bill[],
): string {
  return [
    "*PILIH TUNGGAKAN SANTRI*",
    "",
    `Santri: ${studentName}`,
    `Tagihan: ${billingName}`,
    "Balas nomor tunggakan yang akan dicatat lunas. Pisahkan beberapa nomor dengan koma, misalnya: 1, 3",
    "",
    ...bills.map(
      (bill, index) =>
        `${index + 1}. Periode ${bill.periodeMulai} s.d. ${bill.periodeSelesai} — sisa ${formatRupiah(bill.sisa)}`,
    ),
  ].join("\n");
}

export function arrearsPaymentChannelChoice(
  billingName: string,
  bills: Bill[],
  nominal: number,
  channels: PaymentChannel[],
): string {
  const total = bills.reduce((sum, bill) => sum + bill.sisa, 0);
  return [
    "*KONFIRMASI PEMBAYARAN TUNGGAKAN*",
    "",
    `Tagihan: ${billingName}`,
    `Tunggakan dipilih: ${bills.length}`,
    `Total tunggakan dipilih: ${formatRupiah(total)}`,
    `Nominal pembayaran: ${formatRupiah(nominal)}`,
    `Jenis: ${nominal < total ? "cicilan" : "pelunasan"}`,
    "",
    "Pilih channel pembayaran dengan membalas nomor:",
    ...paymentChannelLines(channels),
  ].join("\n");
}

export function arrearsPaymentAmountPrompt(
  billingName: string,
  bills: Bill[],
): string {
  const total = bills.reduce((sum, bill) => sum + bill.sisa, 0);
  return [
    "*MASUKKAN NOMINAL TUNGGAKAN*",
    "",
    `Tagihan: ${billingName}`,
    `Tunggakan dipilih: ${bills.length}`,
    `Total tunggakan dipilih: ${formatRupiah(total)}`,
    "",
    "Balas nominal yang akan dibayar, misalnya: *65000*, *65.000*, atau *65k*.",
    "Ketik *Lunas* untuk melunasi seluruh tunggakan yang dipilih.",
    "Nominal dialokasikan dari periode terlama ke terbaru.",
  ].join("\n");
}

export function billingPaymentProofRequest(channel: PaymentChannel): string {
  return [
    `Channel ${channel.nama} dipilih.`,
    "",
    "Silakan kirim foto bukti pembayaran pada pesan berikutnya.",
    "Bukti akan diteruskan kepada PJ untuk diverifikasi secara manual.",
  ].join("\n");
}

export function billingPaymentSubmitted(
  nominal: number,
  isInstallment: boolean,
): string {
  return [
    `Pengajuan ${isInstallment ? "cicilan" : "pelunasan"} sebesar ${formatRupiah(nominal)} berhasil diterima.`,
    "Status pembayaran: *MENUNGGU VERIFIKASI PJ*.",
  ].join("\n");
}

export function arrearsPaymentSubmitted(
  nominal: number,
  billCount: number,
  isInstallment: boolean,
): string {
  return [
    `Pengajuan ${isInstallment ? "cicilan" : "pelunasan"} ${billCount} tunggakan sebesar ${formatRupiah(nominal)} berhasil diterima.`,
    "Status pembayaran: *MENUNGGU VERIFIKASI PJ*.",
  ].join("\n");
}

export function paymentReviewRequestMessage(
  payment: PendingPaymentReview,
  waitingCount = 0,
): string {
  return [
    "*PENGAJUAN PEMBAYARAN BARU*",
    "",
    `Santri: ${payment.payerName} (@${payment.payerUsername})`,
    `Tagihan: ${payment.billingName}`,
    `Jenis: ${payment.ruangLingkup === "ARREARS" ? "Tunggakan" : "Tagihan berjalan"}`,
    `Nominal: ${formatRupiah(payment.nominal)}`,
    `Bukti: ${payment.proofStorageKey ? "dikirim bersama notifikasi ini" : "tidak diperlukan (Cash)"}`,
    "",
    "Setujui dengan: Acc / Setujui / Ok",
    "Tolak dengan: Tolak <alasan>",
    "Contoh: Tolak nominal pada bukti tidak sesuai",
    ...(waitingCount > 0
      ? ["", `${waitingCount} pengajuan lain menunggu dalam antrean PJ.`]
      : []),
  ].join("\n");
}

/** Shows the active review plus the remaining queue when a PJ asks for it. */
export function pendingPaymentReviewsMessage(
  activePayment: PendingPaymentReview | null,
  waitingCount: number,
): string {
  if (!activePayment) {
    return waitingCount > 0
      ? `${waitingCount} pengajuan masih menunggu untuk disampaikan ke Anda. Ketik List pengajuan lagi.`
      : "Tidak ada pengajuan pembayaran yang menunggu keputusan Anda.";
  }
  return paymentReviewRequestMessage(activePayment, waitingCount);
}

export function paymentDecisionSubmittedMessage(
  payment: PendingPaymentReview,
  approve: boolean,
  rejectionReason?: string,
): string {
  if (approve) {
    return [
      "*PEMBAYARAN DISETUJUI*",
      `Santri: ${payment.payerName}`,
      `Tagihan: ${payment.billingName}`,
      `Nominal: ${formatRupiah(payment.nominal)}`,
    ].join("\n");
  }

  return [
    "*PEMBAYARAN DITOLAK*",
    `Santri: ${payment.payerName}`,
    `Tagihan: ${payment.billingName}`,
    `Alasan: ${rejectionReason}`,
  ].join("\n");
}

export function paymentDecisionNotificationMessage(
  payment: PendingPaymentReview,
  approve: boolean,
  rejectionReason?: string,
): string {
  if (approve) {
    return [
      "*PEMBAYARAN DISETUJUI*",
      `Tagihan: ${payment.billingName}`,
      `Nominal: ${formatRupiah(payment.nominal)}`,
      "Pembayaran Anda telah dikonfirmasi.",
    ].join("\n");
  }

  return [
    "*PEMBAYARAN DITOLAK*",
    `Tagihan: ${payment.billingName}`,
    `Nominal: ${formatRupiah(payment.nominal)}`,
    `Alasan: ${rejectionReason}`,
    "Silakan perbaiki pengajuan pembayaran Anda bila diperlukan.",
  ].join("\n");
}

export function adminPaymentRecordedMessage(input: {
  studentName: string;
  billingName: string;
  nominal: number;
  arrearsBillCount?: number;
}): string {
  return [
    "*PEMBAYARAN DICATAT*",
    `Santri: ${input.studentName}`,
    `Tagihan: ${input.billingName}`,
    ...(input.arrearsBillCount
      ? [`Tunggakan dilunasi: ${input.arrearsBillCount} periode`]
      : []),
    `Nominal: ${formatRupiah(input.nominal)}`,
    "Status: *DISETUJUI*",
  ].join("\n");
}

export function adminPaymentRecordedNotification(input: {
  billingName: string;
  nominal: number;
  arrearsBillCount?: number;
}): string {
  return [
    "*PEMBAYARAN DICATAT PJ*",
    `Tagihan: ${input.billingName}`,
    ...(input.arrearsBillCount
      ? [`Tunggakan dibayar: ${input.arrearsBillCount} periode`]
      : []),
    `Nominal: ${formatRupiah(input.nominal)}`,
    "Pembayaran telah dicatat dan disetujui oleh PJ tagihan.",
  ].join("\n");
}

export function approvedPaymentsForReversalMessage(
  payments: ApprovedPaymentReview[],
): string {
  if (payments.length === 0) {
    return "Tidak ada pembayaran APPROVED yang dapat dibalikkan untuk tagihan ini.";
  }
  return [
    "*RIWAYAT PEMBAYARAN DISETUJUI*",
    "",
    ...payments.map((payment, index) => [
      `${index + 1}. ${payment.payerName} (@${payment.payerUsername})`,
      `   ${payment.ruangLingkup === "ARREARS" ? "Tunggakan" : "Tagihan berjalan"} — ${formatRupiah(payment.nominal)}`,
      `   Disetujui: ${payment.verifiedAt ?? "tidak diketahui"}`,
    ].join("\n")),
    "",
    "Reversal: Reversal <nomor> <alasan>",
    "Contoh: Reversal 2 pembayaran tercatat dua kali",
  ].join("\n");
}

export function paymentReversalConfirmationMessage(input: {
  payment: ApprovedPaymentReview;
  reason: string;
}): string {
  return [
    "*KONFIRMASI REVERSAL PEMBAYARAN*",
    `Santri: ${input.payment.payerName}`,
    `Tagihan: ${input.payment.billingName}`,
    `Nominal: ${formatRupiah(input.payment.nominal)}`,
    `Alasan: ${input.reason}`,
    "",
    "Reversal menghapus alokasi aktif, menghitung ulang bill, lalu membatalkan pembayaran.",
    "Balas *Ya* untuk melanjutkan atau *Tidak* / *Batal* untuk membatalkan.",
  ].join("\n");
}

export function paymentReversedMessage(input: {
  payment: ApprovedPaymentReview;
  reason: string;
}): string {
  return [
    "*PEMBAYARAN DIBALIKKAN*",
    `Santri: ${input.payment.payerName}`,
    `Tagihan: ${input.payment.billingName}`,
    `Nominal: ${formatRupiah(input.payment.nominal)}`,
    `Alasan: ${input.reason}`,
    "Status pembayaran menjadi *CANCELLED* dan bill terkait telah dihitung ulang.",
  ].join("\n");
}

export function paymentReversalNotificationMessage(input: {
  billingName: string;
  nominal: number;
  reason: string;
}): string {
  return [
    "*PEMBAYARAN DIBALIKKAN*",
    `Tagihan: ${input.billingName}`,
    `Nominal: ${formatRupiah(input.nominal)}`,
    `Alasan: ${input.reason}`,
    "Silakan hubungi PJ tagihan bila membutuhkan penjelasan.",
  ].join("\n");
}
