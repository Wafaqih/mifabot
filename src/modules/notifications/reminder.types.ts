export type ReminderDeliveryStatus = "PENDING" | "SENT" | "FAILED";

/** A date offset relative to a bill's due date: H-7 = -7, H+3 = 3. */
export interface BillingReminderRule {
  id: string;
  billingDefinitionId: string;
  offsetDays: number;
  isActive: boolean;
  configuredBy: string | null;
  deactivatedBy: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingReminderRecipient {
  userId: string;
  username: string;
  jenisKelamin: "L" | "P";
  nomorWhatsapp: string;
  billId: string;
  billingDefinitionId: string;
  billingName: string;
  jatuhTempo: string;
  sisa: number;
  ruleId?: string;
  offsetDays?: number;
}

export interface SetBillingReminderRulesInput {
  billingDefinitionId: string;
  offsets: number[];
  configuredBy?: string | null;
}

export interface DispatchManualBillingRemindersInput {
  billingDefinitionId: string;
  requestedBy?: string | null;
  /** Primarily makes the operation deterministic for jobs and tests. */
  asOf?: string;
  sendMessage: (phoneNumber: string, text: string) => Promise<void>;
}

export interface DispatchAutomaticBillingRemindersInput {
  asOf: string;
  sendMessage: (phoneNumber: string, text: string) => Promise<void>;
}

export interface ReminderDispatchSummary {
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

/** The single WhatsApp group used for manual payment-report broadcasts. */
export interface ManualReminderGroupConfiguration {
  groupJid: string;
  configuredBy: string | null;
  configuredAt: string;
  updatedAt: string;
}

/** Aggregate of the current billing period from its start through `asOf`. */
export interface ManualGroupBillingReminderReport {
  billingName: string;
  periodStart: string;
  asOf: string;
  santriPaidCount: number;
  santriTargetCount: number;
  santriPaidAmount: number;
  santriahPaidCount: number;
  santriahTargetCount: number;
  santriahPaidAmount: number;
  totalPaidCount: number;
  totalPaidAmount: number;
  totalUnpaidCount: number;
  totalOutstandingAmount: number;
}
