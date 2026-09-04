export type PaymentScope = "CURRENT_BILL" | "ARREARS";
export type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type PaymentMethod = "DANA" | "E_WALLET" | "BANK_TRANSFER" | "CASH";
export type PaymentSubmissionType =
  | "USER_SELF"
  | "ADMIN_SELF"
  | "ADMIN_FOR_USER";

export interface Payment {
  id: string;
  userId: string;
  submittedBy: string;
  routedToAdminId: string;
  verifiedBy: string | null;
  requestedBillId: string | null;
  paymentChannelId: string | null;
  billingDefinitionId: string;
  billingName: string;
  ruangLingkup: PaymentScope;
  nominal: number;
  proofStorageKey: string | null;
  submissionType: PaymentSubmissionType;
  status: PaymentStatus;
  submittedAt: string;
  /** Set only while this payment is the active review for its routed PJ. */
  reviewNotifiedAt: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

/** A pending payment enriched with the payer identity needed by a PJ review list. */
export interface PendingPaymentReview extends Payment {
  payerName: string;
  payerUsername: string;
  payerWhatsAppNumber: string;
  reviewerWhatsAppNumber: string;
}

/** An approved payment enriched for the tightly scoped reversal inbox. */
export interface ApprovedPaymentReview extends PendingPaymentReview {}

export interface PaymentReversal {
  id: string;
  paymentId: string;
  reversedBy: string;
  reason: string;
  reversedAt: string;
}

export interface PaymentChannel {
  id: string;
  adminUserId: string;
  nama: string;
  metode: PaymentMethod;
  nomorRekening: string | null;
  namaPemilik: string | null;
  instruksi: string | null;
  urutan: number;
}

export interface CreatePaymentChannelInput {
  billingDefinitionId: string;
  adminUserId: string;
  nama: string;
  metode: Exclude<PaymentMethod, "DANA">;
  nomorRekening?: string | null;
  namaPemilik?: string | null;
  instruksi?: string | null;
}

export interface CurrentPaymentInput {
  userId: string;
  submittedBy: string;
  billId: string;
  billingDefinitionId: string;
  nominal: number;
  proofStorageKey?: string | null;
  paymentChannelId?: string | null;
  submissionType?: PaymentSubmissionType;
}

export interface ArrearsPaymentInput {
  userId: string;
  submittedBy: string;
  billingDefinitionId: string;
  billIds: string[];
  /** Omit only for the legacy admin flow, which pays every selected bill. */
  nominal?: number;
  proofStorageKey?: string | null;
  paymentChannelId?: string | null;
  submissionType?: PaymentSubmissionType;
}

export interface PaymentDecisionInput {
  paymentId: string;
  verifierId: string;
  approve: boolean;
  rejectionReason?: string;
}

export interface PaymentReversalInput {
  paymentId: string;
  reversedBy: string;
  reason: string;
}
