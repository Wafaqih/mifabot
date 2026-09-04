import type { Bill, BillingDefinition, BillingInterval } from "./billing.types.js";
import type { ActiveUser } from "../access/access.repository.js";

function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

function greeting(user: Pick<ActiveUser, "username" | "jenisKelamin">): string {
  return `Assalamu'alaikum ${user.jenisKelamin === "L" ? "Mang" : "Teh"} ${user.username}!`;
}

function billLabel(bill: Bill): string {
  return bill.billingName;
}

function formatBillingInterval(interval: BillingInterval): string {
  const labels: Record<BillingInterval, string> = {
    WEEKLY: "Mingguan",
    MONTHLY: "Bulanan",
    YEARLY: "Tahunan",
    CUSTOM: "Custom",
  };
  return labels[interval];
}

function billLines(bill: Bill): string[] {
  return [
    `${billLabel(bill)}  ${formatRupiah(bill.nominal)}`,
    `Dibayar       : ${formatRupiah(bill.totalDibayar)}`,
    `Sisa          : ${formatRupiah(bill.sisa)}`,
  ];
}

export function buildBillsMessage(
  user: ActiveUser,
  currentBills: Bill[],
  arrears: Bill[],
): string {
  const currentLines = currentBills.flatMap((bill) => billLines(bill));
  const arrearsTotal = arrears.reduce((total, bill) => total + bill.sisa, 0);
  const lines = [
    greeting(user),
    "",
    "*TAGIHAN ANDA*",
    "",
    "*TAGIHAN BERJALAN*",
    ...(currentLines.length > 0
      ? currentLines
      : ["Belum ada tagihan aktif untuk periode ini, atau seluruhnya sudah lunas."]),
    "",
    "*TUNGGAKAN SEBELUMNYA*",
    ...(arrears.length > 0
      ? [
          ...arrears.flatMap((bill) => billLines(bill)),
          `Total tunggakan: ${formatRupiah(arrearsTotal)}`,
        ]
      : ["Tidak ada tunggakan."]),
  ];

  return lines.join("\n");
}

export function buildBillingDefinitionListMessage(
  definitions: Array<{ definition: BillingDefinition; nominal: number | null }>,
): string {
  const lines = ["*DAFTAR TAGIHAN*"];
  if (definitions.length === 0) {
    lines.push("", "Belum ada tagihan yang dibuat.");
    return lines.join("\n");
  }

  for (const [index, { definition, nominal }] of definitions.entries()) {
    lines.push(
      "",
      `${index + 1}. *${definition.name}*`,
      `   Nominal default: ${nominal === null ? "Belum diatur" : formatRupiah(nominal)}`,
      `   Interval: ${formatBillingInterval(definition.interval)}`,
      `   Status: ${definition.isActive ? "Aktif" : "Nonaktif"}`,
    );
  }
  lines.push("", "Hapus tagihan <nama tagihan> untuk menonaktifkan tagihan.");
  return lines.join("\n");
}
