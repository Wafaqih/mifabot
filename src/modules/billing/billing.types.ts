export type BillingInterval = "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";

export interface BillingDefinition {
  id: string;
  code: string;
  name: string;
  interval: BillingInterval;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingRate {
  id: string;
  billingDefinitionId: string;
  userId: string | null;
  nominal: number;
  berlakuMulai: string;
  berlakuSampai: string | null;
}

export interface BillingResponsible {
  id: string;
  billingDefinitionId: string;
  userId: string;
  username: string;
  namaLengkap: string;
  nomorWhatsapp: string;
  isActive: boolean;
}

export interface Bill {
  id: string;
  userId: string;
  billingDefinitionId: string;
  billingName: string;
  tariffId: string | null;
  periodeMulai: string;
  periodeSelesai: string;
  jatuhTempo: string;
  nominal: number;
  status: "BELUM_BAYAR" | "CICIL" | "LUNAS";
  totalDibayar: number;
  sisa: number;
}

export interface BillPeriod {
  periodeMulai: string;
  periodeSelesai: string;
  jatuhTempo: string;
}

export interface CreateBillInput extends BillPeriod {
  userId: string;
  billingDefinitionId: string;
  dibuatOleh?: string | null;
}

export interface BillFilter {
  userId: string;
  asOf?: string;
  billingDefinitionId?: string;
}

export interface GenerateBillsInput extends BillPeriod {
  billingDefinitionId: string;
  userId?: string;
  dibuatOleh?: string | null;
}

export interface CreateBillingDefinitionInput {
  name: string;
  nominal: number;
  interval: BillingInterval;
  createdBy?: string | null;
  effectiveDate?: string;
}

export interface SetBillingNominalInput {
  billingDefinitionId: string;
  nominal: number;
  /** Omit or pass an empty list to change every student's base rate. */
  userIds?: string[];
  /** Local application date on which the command was accepted. */
  asOf?: string;
  createdBy?: string | null;
}

export interface AddBillingResponsibleInput {
  billingDefinitionId: string;
  userId: string;
  /** Local application date on which the definition is activated. */
  asOf?: string;
}

export interface RemoveBillingResponsibleInput {
  billingDefinitionId: string;
  userId: string;
}
