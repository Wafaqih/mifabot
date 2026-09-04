import type { ArrearsReport, PaymentAuditEntry, PaymentReport } from "./payment-report.types.js";

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

export function paymentReportMessage(report: PaymentReport): string {
  const totals = report.totalsByStatus;
  return [
    "*LAPORAN PEMBAYARAN*",
    `Tagihan: ${report.billingName}`,
    `Periode: ${report.period ?? "Semua periode"}`,
    `Jumlah transaksi: ${report.rows.length}`,
    `Total tercatat: ${formatRupiah(report.totalNominal)}`,
    "",
    `Menunggu: ${totals.PENDING.count} (${formatRupiah(totals.PENDING.nominal)})`,
    `Disetujui: ${totals.APPROVED.count} (${formatRupiah(totals.APPROVED.nominal)})`,
    `Ditolak: ${totals.REJECTED.count} (${formatRupiah(totals.REJECTED.nominal)})`,
    `Dibalikkan: ${totals.CANCELLED.count} (${formatRupiah(totals.CANCELLED.nominal)})`,
  ].join("\n");
}

export function arrearsReportMessage(report: ArrearsReport): string {
  return [
    "*LAPORAN TUNGGAKAN*",
    `Tagihan: ${report.billingName}`,
    `Per tanggal: ${report.asOf}`,
    `Bill tertunggak: ${report.rows.length}`,
    `Total sisa: ${formatRupiah(report.totalSisa)}`,
  ].join("\n");
}

function auditStatus(entry: PaymentAuditEntry): string {
  const value = entry.newData?.status ?? entry.oldData?.status;
  return typeof value === "string" ? ` — ${value}` : "";
}

export function paymentAuditMessage(entries: PaymentAuditEntry[]): string {
  if (entries.length === 0) return "Belum ada audit log pembayaran untuk tagihan ini.";
  return [
    "*AUDIT LOG PEMBAYARAN*",
    "Menampilkan maksimal 50 aktivitas terakhir.",
    "",
    ...entries.map((entry, index) => `${index + 1}. ${entry.action}${auditStatus(entry)}\n   ${entry.actorName ?? "Sistem"}${entry.actorUsername ? ` (@${entry.actorUsername})` : ""} — ${entry.createdAt}`),
  ].join("\n");
}
