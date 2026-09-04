import { withTransaction } from "../../core/database/pool.js";
import {
  getUserRole,
  isActiveDefinitionResponsible,
} from "../payments/payment.repository.js";
import type { PaymentStatus } from "../payments/payment.types.js";
import {
  listArrearsReportRows,
  listPaymentAuditEntries,
  listPaymentReportRows,
} from "./payment-report.repository.js";
import type {
  ArrearsReport,
  PaymentAuditEntry,
  PaymentReport,
} from "./payment-report.types.js";

function validatePeriod(period: string | null): void {
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error("Periode laporan harus berbentuk YYYY-MM.");
  }
}

async function assertCanReadPaymentReporting(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  actorUserId: string,
  billingDefinitionId: string,
): Promise<void> {
  const role = await getUserRole(client, actorUserId);
  if (role === "SUPER_ADMIN") return;
  if (role !== "ADMIN") {
    throw new Error("Laporan pembayaran hanya tersedia untuk admin.");
  }
  if (!(await isActiveDefinitionResponsible(client, billingDefinitionId, actorUserId))) {
    throw new Error("Admin bukan penanggung jawab aktif tagihan ini.");
  }
}

function emptyStatusTotals(): PaymentReport["totalsByStatus"] {
  const statuses: PaymentStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
  return Object.fromEntries(
    statuses.map((status) => [status, { count: 0, nominal: 0 }]),
  ) as PaymentReport["totalsByStatus"];
}

export async function getPaymentReport(input: {
  actorUserId: string;
  billingDefinitionId: string;
  billingName: string;
  period: string | null;
}): Promise<PaymentReport> {
  validatePeriod(input.period);
  return withTransaction(async (client) => {
    await assertCanReadPaymentReporting(client, input.actorUserId, input.billingDefinitionId);
    const rows = await listPaymentReportRows(client, input.billingDefinitionId, input.period);
    const totalsByStatus = emptyStatusTotals();
    let totalNominal = 0;
    for (const row of rows) {
      totalNominal += row.nominal;
      totalsByStatus[row.status].count += 1;
      totalsByStatus[row.status].nominal += row.nominal;
    }
    return { billingName: input.billingName, period: input.period, rows, totalNominal, totalsByStatus };
  });
}

export async function getArrearsReport(input: {
  actorUserId: string;
  billingDefinitionId: string;
  billingName: string;
  asOf: string;
}): Promise<ArrearsReport> {
  return withTransaction(async (client) => {
    await assertCanReadPaymentReporting(client, input.actorUserId, input.billingDefinitionId);
    const rows = await listArrearsReportRows(client, input.billingDefinitionId, input.asOf);
    return {
      billingName: input.billingName,
      asOf: input.asOf,
      rows,
      totalSisa: rows.reduce((total, row) => total + row.sisa, 0),
    };
  });
}

export async function getPaymentAuditLog(input: {
  actorUserId: string;
  billingDefinitionId: string;
}): Promise<PaymentAuditEntry[]> {
  return withTransaction(async (client) => {
    await assertCanReadPaymentReporting(client, input.actorUserId, input.billingDefinitionId);
    return listPaymentAuditEntries(client, input.billingDefinitionId);
  });
}
