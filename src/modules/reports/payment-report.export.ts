import ExcelJS from "exceljs";

import type { ArrearsReport, PaymentReport } from "./payment-report.types.js";

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

function asBuffer(value: ArrayBuffer | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  row.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function exportPaymentReport(report: PaymentReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Pembayaran");
  sheet.columns = [
    { header: "Santri", key: "payerName", width: 28 },
    { header: "Username", key: "payerUsername", width: 18 },
    { header: "Jenis", key: "scope", width: 18 },
    { header: "Nominal", key: "nominal", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Channel", key: "channelName", width: 22 },
    { header: "Diajukan", key: "submittedAt", width: 24 },
    { header: "Diverifikasi", key: "verifiedAt", width: 24 },
    { header: "Verifier", key: "verifierName", width: 24 },
    { header: "Alasan", key: "rejectionReason", width: 36 },
  ];
  for (const row of report.rows) {
    sheet.addRow({
      ...row,
      scope: row.scope === "ARREARS" ? "Tunggakan" : "Tagihan berjalan",
      submittedAt: row.submittedAt,
      verifiedAt: row.verifiedAt ?? "",
      channelName: row.channelName ?? "Pencatatan PJ",
      verifierName: row.verifierName ?? "",
      rejectionReason: row.rejectionReason ?? "",
    });
  }
  styleHeader(sheet);
  sheet.getColumn("nominal").numFmt = '#,##0';
  const summary = workbook.addWorksheet("Ringkasan");
  summary.columns = [{ width: 20 }, { width: 18 }, { width: 18 }];
  summary.addRows([
    ["Tagihan", report.billingName],
    ["Periode", report.period ?? "Semua periode"],
    ["Total nominal", report.totalNominal],
    [],
    ["Status", "Jumlah", "Nominal"],
    ...Object.entries(report.totalsByStatus).map(([status, total]) => [status, total.count, total.nominal]),
  ]);
  summary.getRow(5).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  summary.getColumn(3).numFmt = '#,##0';
  return asBuffer(await workbook.xlsx.writeBuffer());
}

export async function exportArrearsReport(report: ArrearsReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tunggakan");
  sheet.columns = [
    { header: "Santri", key: "studentName", width: 28 },
    { header: "Username", key: "studentUsername", width: 18 },
    { header: "Periode mulai", key: "periodeMulai", width: 15 },
    { header: "Periode selesai", key: "periodeSelesai", width: 16 },
    { header: "Jatuh tempo", key: "jatuhTempo", width: 15 },
    { header: "Nominal", key: "nominal", width: 16 },
    { header: "Terbayar", key: "totalDibayar", width: 16 },
    { header: "Sisa", key: "sisa", width: 16 },
    { header: "Status", key: "status", width: 16 },
  ];
  report.rows.forEach((row) => sheet.addRow(row));
  styleHeader(sheet);
  ["nominal", "totalDibayar", "sisa"].forEach((key) => { sheet.getColumn(key).numFmt = '#,##0'; });
  const summary = workbook.addWorksheet("Ringkasan");
  summary.columns = [{ width: 20 }, { width: 20 }];
  summary.addRows([
    ["Tagihan", report.billingName],
    ["Per tanggal", report.asOf],
    ["Jumlah bill", report.rows.length],
    ["Total tunggakan", report.totalSisa],
    ["Total tunggakan (format)", formatRupiah(report.totalSisa)],
  ]);
  summary.getColumn(2).numFmt = '#,##0';
  return asBuffer(await workbook.xlsx.writeBuffer());
}
