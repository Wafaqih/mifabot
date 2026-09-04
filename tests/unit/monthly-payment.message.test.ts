import assert from "node:assert/strict";
import test from "node:test";

import {
  adminArrearsBillSelectionMessage,
  adminArrearsPaymentGuide,
  adminCurrentPaymentGuide,
  adminPaymentRecordedMessage,
  arrearsBillSelectionMessage,
  arrearsPaymentAmountPrompt,
  arrearsPaymentChannelChoice,
  arrearsPaymentSubmitted,
  billingPaymentAmountError,
  billingPaymentChannelChoice,
  billingPaymentGuide,
  billingPaymentSubmitted,
  paymentDecisionNotificationMessage,
  paymentDecisionSubmittedMessage,
  paymentReviewRequestMessage,
  pendingPaymentReviewsMessage,
} from "../../src/modules/payments/monthly-payment.message.js";
import {
  parseAdminArrearsPaymentCommand,
  parseAdminCurrentPaymentCommand,
  parseArrearsPaymentCommand,
  parseBillingReportCommand,
  parseBillingPaymentCommand,
  parsePaymentDecisionCommand,
  parsePaymentReversalCommand,
} from "../../src/integrations/whatsapp/message.js";
import type { Bill } from "../../src/modules/billing/billing.types.js";
import type {
  PaymentChannel,
  PendingPaymentReview,
} from "../../src/modules/payments/payment.types.js";

const bill: Bill = {
  id: "bill-1",
  userId: "user-1",
  billingDefinitionId: "definition-bulanan",
  billingName: "Bulanan",
  tariffId: null,
  periodeMulai: "2026-08-01",
  periodeSelesai: "2026-08-31",
  jatuhTempo: "2026-08-01",
  nominal: 65000,
  status: "BELUM_BAYAR",
  totalDibayar: 0,
  sisa: 65000,
};

const channels: PaymentChannel[] = [
  {
    id: "channel-1",
    adminUserId: "admin-1",
    nama: "Tunai Bendahara",
    metode: "CASH",
    nomorRekening: null,
    namaPemilik: null,
    instruksi: "Bayar langsung ke bendahara.",
    urutan: 1,
  },
];

test("parseBillingPaymentCommand supports dynamic names, rupiah, and cicilan", () => {
  assert.deepEqual(parseBillingPaymentCommand("Bayar SPP"), {
    billingName: "SPP",
    nominal: null,
    isFullPayment: false,
  });
  assert.deepEqual(parseBillingPaymentCommand("bayar SPP Rp30.000"), {
    billingName: "SPP",
    nominal: 30000,
    isFullPayment: false,
  });
  assert.deepEqual(parseBillingPaymentCommand("Bayar Iuran Makan 30000"), {
    billingName: "Iuran Makan",
    nominal: 30000,
    isFullPayment: false,
  });
  assert.deepEqual(parseBillingPaymentCommand("Bayar SPP 65.000"), {
    billingName: "SPP",
    nominal: 65000,
    isFullPayment: false,
  });
  assert.deepEqual(parseBillingPaymentCommand("Bayar SPP 65k"), {
    billingName: "SPP",
    nominal: 65000,
    isFullPayment: false,
  });
  assert.deepEqual(parseBillingPaymentCommand("Bayar SPP lunas"), {
    billingName: "SPP",
    nominal: null,
    isFullPayment: true,
  });
  assert.equal(parseBillingPaymentCommand("Bayar SPP tiga puluh ribu")?.nominal, null);
});

test("arrears and payment-decision commands keep their conversation arguments", () => {
  assert.deepEqual(parseArrearsPaymentCommand('Bayar tunggakan "Iuran Makan"'), {
    billingName: "Iuran Makan",
  });
  assert.deepEqual(parseArrearsPaymentCommand("Bayar tunggakan"), {
    billingName: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("List pengajuan"), {
    action: "LIST",
    reference: null,
    rejectionReason: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("Setujui 2"), {
    action: "APPROVE",
    reference: "2",
    rejectionReason: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("Setujui"), {
    action: "APPROVE",
    reference: null,
    rejectionReason: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("acc"), {
    action: "APPROVE",
    reference: null,
    rejectionReason: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("OK"), {
    action: "APPROVE",
    reference: null,
    rejectionReason: null,
  });
  assert.deepEqual(parsePaymentDecisionCommand("Tolak bukti transfer tidak sesuai"), {
    action: "REJECT",
    reference: null,
    rejectionReason: "bukti transfer tidak sesuai",
  });
  assert.deepEqual(
    parsePaymentDecisionCommand("Tolak 3 bukti transfer tidak sesuai"),
    {
      action: "REJECT",
      reference: "3",
      rejectionReason: "bukti transfer tidak sesuai",
    },
  );
});

test("report and reversal commands retain the dynamic billing name and short-lived reference", () => {
  assert.deepEqual(
    parseBillingReportCommand('Export pembayaran "Iuran Makan" 2026-09'),
    {
      action: "EXPORT",
      subject: "PAYMENTS",
      billingName: "Iuran Makan",
      period: "2026-09",
    },
  );
  assert.deepEqual(parseBillingReportCommand("Audit pembayaran SPP"), {
    action: "AUDIT",
    subject: "PAYMENTS",
    billingName: "SPP",
    period: null,
  });
  assert.deepEqual(parsePaymentReversalCommand("Riwayat pembayaran SPP"), {
    action: "LIST",
    billingName: "SPP",
    reference: null,
    reason: null,
  });
  assert.deepEqual(
    parsePaymentReversalCommand("Reversal 2 pembayaran tercatat dua kali"),
    {
      action: "REVERSE",
      billingName: null,
      reference: "2",
      reason: "pembayaran tercatat dua kali",
    },
  );
});

test("admin payment commands accept dynamic billing names and a student identifier", () => {
  assert.deepEqual(
    parseAdminCurrentPaymentCommand('Catat bayar "Iuran Makan" ahmad Rp30.000'),
    {
      billingName: "Iuran Makan",
      studentIdentifier: "ahmad",
      nominal: 30000,
      isFullPayment: false,
    },
  );
  assert.deepEqual(parseAdminCurrentPaymentCommand("Catat bayar SPP ahmad lunas"), {
    billingName: "SPP",
    studentIdentifier: "ahmad",
    nominal: null,
    isFullPayment: true,
  });
  assert.deepEqual(
    parseAdminArrearsPaymentCommand("Catat tunggakan SPP 628123456789"),
    {
      billingName: "SPP",
      studentIdentifier: "628123456789",
    },
  );
  assert.deepEqual(parseAdminCurrentPaymentCommand("Catat bayar"), {
    billingName: null,
    studentIdentifier: null,
    nominal: null,
    isFullPayment: false,
  });
});

test("dynamic payment messages explain the selected payment type", () => {
  assert.match(billingPaymentGuide("SPP"), /Bayar SPP 65\.000/);
  assert.match(billingPaymentGuide("SPP"), /65k/);
  assert.match(
    billingPaymentChannelChoice(bill, 30000, channels),
    /Jenis: cicilan/,
  );
  assert.match(
    billingPaymentChannelChoice(bill, 65000, channels),
    /Jenis: pelunasan/,
  );
  assert.match(billingPaymentSubmitted(30000, true), /cicilan/);
  assert.match(billingPaymentAmountError("SPP"), /Format nominal/);
  assert.match(
    billingPaymentChannelChoice(bill, 65000, channels),
    /Cash - Bayar langsung ke bendahara/,
  );
});

test("payment channel message labels E_WALLET as an e-wallet", () => {
  const ewallet: PaymentChannel[] = [
    {
      id: "channel-ewallet",
      adminUserId: "admin-1",
      nama: "DANA Faqih",
      metode: "E_WALLET",
      nomorRekening: "081234567890",
      namaPemilik: "Faqih",
      instruksi: null,
      urutan: 2,
    },
  ];

  assert.match(
    billingPaymentChannelChoice(bill, 65000, ewallet),
    /E-Wallet - 081234567890/,
  );
});

test("arrears messages show selected periods, total, and a pending status", () => {
  const olderBill: Bill = {
    ...bill,
    id: "bill-older",
    periodeMulai: "2026-07-01",
    periodeSelesai: "2026-07-31",
    sisa: 25000,
  };
  assert.match(
    arrearsBillSelectionMessage("Bulanan", [olderBill, bill]),
    /1\. Periode 2026-07-01 s\.d\. 2026-07-31 — sisa Rp25\.000/,
  );
  assert.match(
    arrearsPaymentChannelChoice("Bulanan", [olderBill, bill], 50000, channels),
    /Nominal pembayaran: Rp50\.000/,
  );
  assert.match(
    arrearsPaymentAmountPrompt("Bulanan", [olderBill, bill]),
    /Nominal dialokasikan dari periode terlama ke terbaru/,
  );
  assert.match(arrearsPaymentSubmitted(50000, 2, true), /cicilan 2 tunggakan/);
});

test("admin payment messages explain direct approval and identify the student", () => {
  assert.match(adminCurrentPaymentGuide(), /Catat bayar/);
  assert.match(adminArrearsPaymentGuide(), /Catat tunggakan/);
  assert.match(
    adminArrearsBillSelectionMessage("Ahmad", "Bulanan", [bill]),
    /Santri: Ahmad/,
  );
  assert.match(
    adminPaymentRecordedMessage({
      studentName: "Ahmad",
      billingName: "Bulanan",
      nominal: 65000,
      arrearsBillCount: 1,
    }),
    /Status: \*DISETUJUI\*/,
  );
});

test("payment review messages identify the selected submission and notify the payer", () => {
  const payment: PendingPaymentReview = {
    id: "payment-1",
    userId: "user-1",
    submittedBy: "user-1",
    routedToAdminId: "admin-1",
    verifiedBy: null,
    requestedBillId: "bill-1",
    paymentChannelId: "channel-1",
    billingDefinitionId: "definition-bulanan",
    billingName: "Bulanan",
    ruangLingkup: "CURRENT_BILL",
    nominal: 65000,
    proofStorageKey: "drive-file-id",
    submissionType: "USER_SELF",
    status: "PENDING",
    submittedAt: "2026-09-01T00:00:00.000Z",
    reviewNotifiedAt: "2026-09-01T00:01:00.000Z",
    verifiedAt: null,
    rejectionReason: null,
    payerName: "Ahmad",
    payerUsername: "ahmad",
    payerWhatsAppNumber: "628123456789",
    reviewerWhatsAppNumber: "628987654321",
  };

  assert.match(paymentReviewRequestMessage(payment, 2), /Acc \/ Setujui \/ Ok/);
  assert.match(paymentReviewRequestMessage(payment, 2), /2 pengajuan lain menunggu/);
  assert.match(
    paymentReviewRequestMessage(payment, 2),
    /dikirim bersama notifikasi ini/,
  );
  assert.match(pendingPaymentReviewsMessage(payment, 0), /PENGAJUAN PEMBAYARAN BARU/);
  assert.match(paymentDecisionSubmittedMessage(payment, true), /DISETUJUI/);
  assert.match(
    paymentDecisionNotificationMessage(payment, false, "bukti tidak sesuai"),
    /bukti tidak sesuai/,
  );
});
