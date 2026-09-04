import type { PaymentScope, PaymentStatus } from "../payments/payment.types.js";

export interface PaymentReportRow {
  paymentId: string;
  payerName: string;
  payerUsername: string;
  scope: PaymentScope;
  nominal: number;
  status: PaymentStatus;
  submissionType: string;
  channelName: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  verifierName: string | null;
  rejectionReason: string | null;
}

export interface PaymentReport {
  billingName: string;
  period: string | null;
  rows: PaymentReportRow[];
  totalNominal: number;
  totalsByStatus: Record<PaymentStatus, { count: number; nominal: number }>;
}

export interface ArrearsReportRow {
  billId: string;
  studentName: string;
  studentUsername: string;
  periodeMulai: string;
  periodeSelesai: string;
  jatuhTempo: string;
  nominal: number;
  totalDibayar: number;
  sisa: number;
  status: "BELUM_BAYAR" | "CICIL" | "LUNAS";
}

export interface ArrearsReport {
  billingName: string;
  asOf: string;
  rows: ArrearsReportRow[];
  totalSisa: number;
}

export interface PaymentAuditEntry {
  id: string;
  action: string;
  paymentId: string;
  actorName: string | null;
  actorUsername: string | null;
  createdAt: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
}
