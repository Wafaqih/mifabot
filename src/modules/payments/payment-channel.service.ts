import { databasePool, withTransaction } from "../../core/database/pool.js";
import { findBillingDefinitionById } from "../billing/billing.repository.js";
import {
  deactivateDefinitionPaymentChannel,
  insertDefinitionPaymentChannel,
  isActiveDefinitionResponsible,
  listDefinitionPaymentChannels,
  updateDefinitionPaymentChannel,
} from "./payment.repository.js";
import type {
  CreatePaymentChannelInput,
  PaymentChannel,
  PaymentMethod,
} from "./payment.types.js";

export type PaymentChannelEditableField =
  | "nama"
  | "nomorRekening"
  | "namaPemilik"
  | "instruksi";

function cleanRequired(value: string, label: string, maxLength: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error(`${label} wajib diisi.`);
  if (cleaned.length > maxLength) {
    throw new Error(`${label} maksimal ${maxLength} karakter.`);
  }
  return cleaned;
}

function fixedMethodOrder(method: PaymentMethod): number {
  if (method === "BANK_TRANSFER") return 1;
  if (method === "DANA" || method === "E_WALLET") return 2;
  return 3;
}

async function ensureDefinitionAndResponsible(
  billingDefinitionId: string,
  adminUserId: string,
): Promise<void> {
  const definition = await findBillingDefinitionById(databasePool, billingDefinitionId);
  if (!definition || !definition.isActive) {
    throw new Error("Tagihan tidak ditemukan atau belum aktif.");
  }

  const isResponsible = await withTransaction((client) =>
    isActiveDefinitionResponsible(client, billingDefinitionId, adminUserId),
  );
  if (!isResponsible) {
    throw new Error("PJ yang dipilih bukan PJ aktif untuk tagihan ini.");
  }
}

export async function createPaymentChannelForDefinition(
  input: CreatePaymentChannelInput,
): Promise<PaymentChannel> {
  await ensureDefinitionAndResponsible(input.billingDefinitionId, input.adminUserId);

  const nama = cleanRequired(input.nama, "Nama metode", 100);
  if (input.metode === "CASH") {
    const instruksi = cleanRequired(input.instruksi ?? "", "Instruksi Cash", 1_000);
    return withTransaction((client) =>
      insertDefinitionPaymentChannel(client, {
        billingDefinitionId: input.billingDefinitionId,
        adminUserId: input.adminUserId,
        nama,
        metode: input.metode,
        nomorRekening: null,
        namaPemilik: null,
        instruksi,
        urutan: fixedMethodOrder(input.metode),
      }),
    );
  }

  const nomorRekening = cleanRequired(
    input.nomorRekening ?? "",
    "Nomor rekening/e-wallet",
    100,
  );
  const namaPemilik = cleanRequired(
    input.namaPemilik ?? "",
    "Nama pemilik",
    200,
  );
  return withTransaction((client) =>
    insertDefinitionPaymentChannel(client, {
      billingDefinitionId: input.billingDefinitionId,
      adminUserId: input.adminUserId,
      nama,
      metode: input.metode,
      nomorRekening,
      namaPemilik,
      instruksi: null,
      urutan: fixedMethodOrder(input.metode),
    }),
  );
}

export async function getPaymentChannelsForDefinition(
  billingDefinitionId: string,
): Promise<PaymentChannel[]> {
  return listDefinitionPaymentChannels(databasePool, billingDefinitionId);
}

export async function updatePaymentChannelForDefinition(input: {
  billingDefinitionId: string;
  channelId: string;
  field: PaymentChannelEditableField;
  value: string;
}): Promise<PaymentChannel> {
  const value = cleanRequired(
    input.value,
    input.field === "instruksi" ? "Instruksi Cash" : "Nilai baru",
    input.field === "nama" ? 100 : input.field === "namaPemilik" ? 200 : 1_000,
  );
  const updated = await withTransaction((client) =>
    updateDefinitionPaymentChannel(client, {
      billingDefinitionId: input.billingDefinitionId,
      channelId: input.channelId,
      ...(input.field === "nama" ? { nama: value } : {}),
      ...(input.field === "nomorRekening" ? { nomorRekening: value } : {}),
      ...(input.field === "namaPemilik" ? { namaPemilik: value } : {}),
      ...(input.field === "instruksi" ? { instruksi: value } : {}),
    }),
  );
  if (!updated) throw new Error("Metode pembayaran aktif tidak ditemukan.");
  return updated;
}

export async function deactivatePaymentChannelForDefinition(input: {
  billingDefinitionId: string;
  channelId: string;
}): Promise<void> {
  const deactivated = await withTransaction((client) =>
    deactivateDefinitionPaymentChannel(
      client,
      input.billingDefinitionId,
      input.channelId,
    ),
  );
  if (!deactivated) throw new Error("Metode pembayaran aktif tidak ditemukan.");
}

