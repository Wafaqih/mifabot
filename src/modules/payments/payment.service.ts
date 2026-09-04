import { withTransaction } from "../../core/database/pool.js";
import {
  cancelApprovedPayment,
  claimNextPaymentReviewForReviewer as claimNextPaymentReviewForReviewerRepository,
  deletePaymentAllocations,
  getActiveChannel,
  getArrearsBills,
  getArrearsSelections,
  getActivePaymentReviewForReviewer as getActivePaymentReviewForReviewerRepository,
  getBillForPayment,
  getPayment,
  getPaymentAllocationsForReversal,
  getUserRole,
  insertAllocations,
  insertArrearsSelections,
  insertPayment,
  insertPaymentAuditLog,
  insertPaymentReversal,
  insertPaymentReversalAllocations,
  isActiveDefinitionResponsible,
  listApprovedPaymentsForReviewer,
  listPendingPaymentsForReviewer,
  listActiveChannels,
  releasePaymentReview as releasePaymentReviewRepository,
  refreshBillStatuses,
  updatePaymentDecision,
} from "./payment.repository.js";
import type {
  ArrearsPaymentInput,
  CurrentPaymentInput,
  Payment,
  PaymentDecisionInput,
  PaymentReversal,
  PaymentReversalInput,
  ApprovedPaymentReview,
  PendingPaymentReview,
  PaymentSubmissionType,
} from "./payment.types.js";

export function validateNominal(nominal: number): void {
  if (!Number.isSafeInteger(nominal) || nominal <= 0) {
    throw new Error("Nominal pembayaran harus berupa bilangan bulat positif.");
  }
}

/**
 * Splits an arrears payment across the selected bills in chronological order.
 * Each selection keeps its full outstanding snapshot; only the allocations
 * carry the submitted partial amount.
 */
export function allocateArrearsPayment(
  nominal: number,
  selections: Array<{ billId: string; nominalWajib: number }>,
): Array<{ billId: string; nominal: number }> {
  validateNominal(nominal);
  let remaining = nominal;
  const allocations: Array<{ billId: string; nominal: number }> = [];

  for (const selection of selections) {
    if (remaining === 0) break;
    const allocated = Math.min(selection.nominalWajib, remaining);
    if (allocated > 0) {
      allocations.push({ billId: selection.billId, nominal: allocated });
      remaining -= allocated;
    }
  }

  if (remaining !== 0) {
    throw new Error("Nominal melebihi total tunggakan yang dipilih.");
  }
  return allocations;
}

export function validateProof(
  proofStorageKey: string | null | undefined,
  metode: string,
  submissionType?: PaymentSubmissionType,
): void {
  if (
    submissionType === "ADMIN_SELF" ||
    submissionType === "ADMIN_FOR_USER"
  ) {
    return;
  }
  if (!proofStorageKey && metode !== "CASH") {
    throw new Error("Bukti pembayaran wajib untuk channel non-cash.");
  }
}

async function assertAdminCanHandleBilling(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  submittedBy: string,
  billingDefinitionId: string,
  targetUserId: string,
  submissionType: PaymentSubmissionType,
): Promise<void> {
  const role = await getUserRole(client, submittedBy);
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    throw new Error("Penanggung jawab harus memiliki role admin.");
  }
  if (submissionType === "ADMIN_FOR_USER" && submittedBy === targetUserId) {
    throw new Error("ADMIN_FOR_USER tidak berlaku untuk pembayaran diri sendiri.");
  }
  if (!(await isActiveDefinitionResponsible(client, billingDefinitionId, submittedBy))) {
    throw new Error("Admin bukan penanggung jawab aktif tagihan ini.");
  }
}

async function getUserChannel(
  client: Parameters<Parameters<typeof withTransaction>[0]>[0],
  paymentChannelId: string | null | undefined,
  billingDefinitionId: string,
) {
  if (!paymentChannelId) throw new Error("Payment channel wajib dipilih.");
  const channel = await getActiveChannel(
    client,
    paymentChannelId,
    billingDefinitionId,
  );
  if (!channel) {
    throw new Error("Payment channel tidak ditemukan, tidak aktif, atau bukan milik PJ tagihan.");
  }
  return channel;
}

export async function getPaymentChannels(billingDefinitionId: string) {
  return withTransaction((client) =>
    listActiveChannels(client, billingDefinitionId),
  );
}

export async function getPendingPaymentsForReviewer(
  reviewerId: string,
): Promise<PendingPaymentReview[]> {
  return withTransaction(async (client) => {
    const role = await getUserRole(client, reviewerId);
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      throw new Error("Daftar pengajuan hanya tersedia untuk role admin.");
    }
    return listPendingPaymentsForReviewer(client, reviewerId);
  });
}

export async function getActivePaymentReviewForReviewer(
  reviewerId: string,
): Promise<PendingPaymentReview | null> {
  return withTransaction(async (client) => {
    const role = await getUserRole(client, reviewerId);
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      throw new Error("Pengajuan pembayaran hanya tersedia untuk role admin.");
    }
    return getActivePaymentReviewForReviewerRepository(client, reviewerId);
  });
}

/** Claims the next queued payment only if the PJ has no active review. */
export async function claimNextPaymentReviewForReviewer(
  reviewerId: string,
): Promise<PendingPaymentReview | null> {
  return withTransaction(async (client) => {
    const role = await getUserRole(client, reviewerId);
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      throw new Error("Pengajuan pembayaran hanya tersedia untuk role admin.");
    }
    return claimNextPaymentReviewForReviewerRepository(client, reviewerId);
  });
}

/** Makes the active payment eligible to be delivered again after a send failure. */
export async function releasePaymentReview(
  paymentId: string,
  reviewerId: string,
): Promise<void> {
  return withTransaction((client) =>
    releasePaymentReviewRepository(client, paymentId, reviewerId),
  );
}

export async function getApprovedPaymentsForReversal(
  reviewerId: string,
  billingDefinitionId: string,
): Promise<ApprovedPaymentReview[]> {
  return withTransaction(async (client) => {
    await assertAdminCanHandleBilling(
      client,
      reviewerId,
      billingDefinitionId,
      reviewerId,
      "ADMIN_SELF",
    );
    return listApprovedPaymentsForReviewer(client, billingDefinitionId);
  });
}

export async function submitUserCurrentPayment(
  input: Omit<CurrentPaymentInput, "submittedBy"> & { submittedBy?: string },
): Promise<Payment> {
  return withTransaction(async (client) => {
    const submittedBy = input.submittedBy ?? input.userId;
    if (submittedBy !== input.userId) {
      throw new Error("User hanya boleh mengajukan pembayaran untuk dirinya sendiri.");
    }
    const role = await getUserRole(client, submittedBy);
    if (role !== "USER") {
      throw new Error("Pengajuan pembayaran user hanya tersedia untuk role USER.");
    }
    const channel = await getUserChannel(
      client,
      input.paymentChannelId,
      input.billingDefinitionId,
    );
    validateProof(input.proofStorageKey, channel.metode, "USER_SELF");
    validateNominal(input.nominal);
    const bill = await getBillForPayment(
      client,
      input.billId,
      input.userId,
      input.billingDefinitionId,
    );
    if (!bill) throw new Error("Tagihan tidak ditemukan.");
    if (bill.sisa < input.nominal) {
      throw new Error("Nominal melebihi sisa tagihan.");
    }
    const payment = await insertPayment(client, {
      userId: input.userId,
      submittedBy,
      routedToAdminId: channel.adminUserId,
      requestedBillId: input.billId,
      paymentChannelId: channel.id,
      billingDefinitionId: input.billingDefinitionId,
      ruangLingkup: "CURRENT_BILL",
      nominal: input.nominal,
      proofStorageKey: input.proofStorageKey ?? null,
      submissionType: "USER_SELF",
      status: "PENDING",
      verifiedBy: null,
    });
    await insertPaymentAuditLog(client, {
      actorUserId: submittedBy,
      action: "PAYMENT_SUBMITTED",
      paymentId: payment.id,
      newData: {
        status: payment.status,
        nominal: payment.nominal,
        scope: payment.ruangLingkup,
      },
    });
    return payment;
  });
}

export async function submitAdminCurrentPayment(
  input: CurrentPaymentInput,
): Promise<Payment> {
  return withTransaction(async (client) => {
    const submissionType: PaymentSubmissionType =
      input.userId === input.submittedBy ? "ADMIN_SELF" : "ADMIN_FOR_USER";
    validateNominal(input.nominal);
    await assertAdminCanHandleBilling(
      client,
      input.submittedBy,
      input.billingDefinitionId,
      input.userId,
      submissionType,
    );
    const bill = await getBillForPayment(
      client,
      input.billId,
      input.userId,
      input.billingDefinitionId,
    );
    if (!bill) throw new Error("Tagihan tidak ditemukan.");
    if (bill.sisa < input.nominal) {
      throw new Error("Nominal melebihi sisa tagihan.");
    }
    const payment = await insertPayment(client, {
      userId: input.userId,
      submittedBy: input.submittedBy,
      routedToAdminId: input.submittedBy,
      requestedBillId: input.billId,
      paymentChannelId: null,
      billingDefinitionId: input.billingDefinitionId,
      ruangLingkup: "CURRENT_BILL",
      nominal: input.nominal,
      proofStorageKey: input.proofStorageKey ?? null,
      submissionType,
      status: "APPROVED",
      verifiedBy: input.submittedBy,
    });
    await insertAllocations(client, payment.id, [
      { billId: input.billId, nominal: input.nominal },
    ]);
    await insertPaymentAuditLog(client, {
      actorUserId: input.submittedBy,
      action: "PAYMENT_RECORDED_BY_ADMIN",
      paymentId: payment.id,
      newData: {
        status: payment.status,
        nominal: payment.nominal,
        scope: payment.ruangLingkup,
      },
    });
    return payment;
  });
}

export async function submitUserArrearsPayment(
  input: Omit<ArrearsPaymentInput, "submittedBy"> & { submittedBy?: string },
): Promise<Payment> {
  return submitArrears(
    { ...input, submittedBy: input.submittedBy ?? input.userId },
    "USER_SELF",
  );
}

export async function submitAdminArrearsPayment(
  input: ArrearsPaymentInput,
): Promise<Payment> {
  const submissionType: PaymentSubmissionType =
    input.userId === input.submittedBy ? "ADMIN_SELF" : "ADMIN_FOR_USER";
  return submitArrears(input, submissionType);
}

async function submitArrears(
  input: ArrearsPaymentInput,
  submissionType: PaymentSubmissionType,
): Promise<Payment> {
  if (input.billIds.length === 0) {
    throw new Error("Minimal satu tunggakan harus dipilih.");
  }
  if (new Set(input.billIds).size !== input.billIds.length) {
    throw new Error("Bill tunggakan tidak boleh dipilih dua kali.");
  }
  return withTransaction(async (client) => {
    if (submissionType === "USER_SELF" && input.submittedBy !== input.userId) {
      throw new Error("User hanya boleh mengajukan pembayaran untuk dirinya sendiri.");
    }
    const channel =
      submissionType === "USER_SELF"
        ? await getUserChannel(
            client,
            input.paymentChannelId,
            input.billingDefinitionId,
          )
        : null;
    if (channel) validateProof(input.proofStorageKey, channel.metode, submissionType);
    if (submissionType !== "USER_SELF") {
      await assertAdminCanHandleBilling(
        client,
        input.submittedBy,
        input.billingDefinitionId,
        input.userId,
        submissionType,
      );
    }

    const asOf = new Date().toISOString().slice(0, 10);
    const bills = await getArrearsBills(
      client,
      input.userId,
      input.billingDefinitionId,
      asOf,
      input.billIds,
    );
    if (bills.length !== input.billIds.length) {
      throw new Error("Ada tunggakan yang tidak valid atau sudah lunas.");
    }
    const selectedTotal = bills.reduce(
      (total, bill) => total + bill.outstanding,
      0,
    );
    const nominal = input.nominal ?? selectedTotal;
    validateNominal(nominal);
    if (nominal > selectedTotal) {
      throw new Error("Nominal melebihi total tunggakan yang dipilih.");
    }
    const payment = await insertPayment(client, {
      userId: input.userId,
      submittedBy: input.submittedBy,
      routedToAdminId:
        submissionType === "USER_SELF" ? channel!.adminUserId : input.submittedBy,
      requestedBillId: null,
      paymentChannelId: channel?.id ?? null,
      billingDefinitionId: input.billingDefinitionId,
      ruangLingkup: "ARREARS",
      nominal,
      proofStorageKey: input.proofStorageKey ?? null,
      submissionType,
      status: submissionType === "USER_SELF" ? "PENDING" : "APPROVED",
      verifiedBy: submissionType === "USER_SELF" ? null : input.submittedBy,
    });
    const selections = bills.map((bill) => ({
      billId: bill.billId,
      nominalWajib: bill.outstanding,
    }));
    await insertArrearsSelections(client, payment.id, selections);
    if (submissionType !== "USER_SELF") {
      await insertAllocations(
        client,
        payment.id,
        allocateArrearsPayment(nominal, selections),
      );
    }
    await insertPaymentAuditLog(client, {
      actorUserId: input.submittedBy,
      action:
        submissionType === "USER_SELF"
          ? "PAYMENT_SUBMITTED"
          : "PAYMENT_RECORDED_BY_ADMIN",
      paymentId: payment.id,
      newData: {
        status: payment.status,
        nominal: payment.nominal,
        scope: payment.ruangLingkup,
      },
    });
    return payment;
  });
}

export async function decidePayment(
  input: PaymentDecisionInput,
): Promise<Payment> {
  return withTransaction(async (client) => {
    const verifierRole = await getUserRole(client, input.verifierId);
    if (verifierRole !== "ADMIN" && verifierRole !== "SUPER_ADMIN") {
      throw new Error("Verifier pembayaran harus memiliki role admin.");
    }
    const payment = await getPayment(client, input.paymentId);
    if (!payment) throw new Error("Pembayaran tidak ditemukan.");
    if (!(await isActiveDefinitionResponsible(
      client,
      payment.billingDefinitionId,
      input.verifierId,
    ))) {
      throw new Error("Verifier bukan penanggung jawab aktif tagihan ini.");
    }
    if (payment.status !== "PENDING") {
      throw new Error("Pembayaran sudah diputuskan.");
    }
    if (!input.approve && !input.rejectionReason?.trim()) {
      throw new Error("Alasan penolakan wajib diisi.");
    }
    const decided = await updatePaymentDecision(
      client,
      input.paymentId,
      input.verifierId,
      input.approve,
      input.approve ? null : input.rejectionReason!.trim(),
    );
    if (input.approve) {
      if (payment.ruangLingkup === "CURRENT_BILL") {
        await insertAllocations(client, payment.id, [
          { billId: payment.requestedBillId!, nominal: payment.nominal },
        ]);
      } else {
        const selections = await getArrearsSelections(client, payment.id);
        if (selections.length === 0) {
          throw new Error("Pilihan tunggakan tidak ditemukan.");
        }
        await insertAllocations(
          client,
          payment.id,
          allocateArrearsPayment(payment.nominal, selections),
        );
      }
    }
    await insertPaymentAuditLog(client, {
      actorUserId: input.verifierId,
      action: input.approve ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
      paymentId: payment.id,
      oldData: { status: payment.status },
      newData: {
        status: decided.status,
        nominal: decided.nominal,
        rejectionReason: decided.rejectionReason,
      },
    });
    return decided;
  });
}

export async function reverseApprovedPayment(
  input: PaymentReversalInput,
): Promise<{ payment: Payment; reversal: PaymentReversal }> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 5 || reason.length > 1_000) {
    throw new Error("Alasan reversal harus terdiri dari 5 sampai 1000 karakter.");
  }

  return withTransaction(async (client) => {
    const reverserRole = await getUserRole(client, input.reversedBy);
    if (reverserRole !== "ADMIN" && reverserRole !== "SUPER_ADMIN") {
      throw new Error("Reversal pembayaran hanya tersedia untuk admin.");
    }
    const payment = await getPayment(client, input.paymentId);
    if (!payment) throw new Error("Pembayaran tidak ditemukan.");
    const responsible = await isActiveDefinitionResponsible(
      client,
      payment.billingDefinitionId,
      input.reversedBy,
    );
    if (!responsible && reverserRole !== "SUPER_ADMIN") {
      throw new Error("Admin bukan penanggung jawab aktif tagihan ini.");
    }
    if (payment.status !== "APPROVED") {
      throw new Error("Hanya pembayaran APPROVED yang dapat dibalikkan.");
    }

    const allocations = await getPaymentAllocationsForReversal(client, payment.id);
    if (allocations.length === 0) {
      throw new Error("Pembayaran APPROVED tidak memiliki alokasi yang dapat dibalikkan.");
    }
    const allocated = allocations.reduce((total, allocation) => total + allocation.nominal, 0);
    if (allocated !== payment.nominal) {
      throw new Error("Alokasi pembayaran tidak lengkap; reversal dibatalkan untuk menjaga konsistensi data.");
    }

    const reversal = await insertPaymentReversal(client, {
      paymentId: payment.id,
      reversedBy: input.reversedBy,
      reason,
    });
    await insertPaymentReversalAllocations(client, reversal.id, allocations);
    await deletePaymentAllocations(client, payment.id);
    await refreshBillStatuses(client, allocations.map((allocation) => allocation.billId));
    const cancelled = await cancelApprovedPayment(client, payment.id);
    await insertPaymentAuditLog(client, {
      actorUserId: input.reversedBy,
      action: "PAYMENT_REVERSED",
      paymentId: payment.id,
      oldData: { status: payment.status, nominal: payment.nominal, allocations },
      newData: { status: cancelled.status, reversalId: reversal.id, reason },
    });
    return { payment: cancelled, reversal };
  });
}
