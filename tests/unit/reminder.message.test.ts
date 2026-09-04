import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomaticBillingReminderMessage,
  buildManualGroupBillingReminderMessage,
  buildManualBillingReminderMessage,
  validateManualReminderGroupJid,
  validateReminderOffsets,
} from "../../src/modules/notifications/reminder.service.js";
import type { BillingReminderRecipient } from "../../src/modules/notifications/reminder.types.js";

const baseRecipient: BillingReminderRecipient = {
  userId: "santri-1",
  username: "budi",
  jenisKelamin: "L",
  nomorWhatsapp: "628123456789",
  billId: "bill-1",
  billingDefinitionId: "definition-spp",
  billingName: "SPP",
  jatuhTempo: "2026-09-05",
  sisa: 75000,
};

test("automatic reminder messages describe H-, H-0, and H+ contexts", () => {
  const beforeDue = buildAutomaticBillingReminderMessage({
    ...baseRecipient,
    offsetDays: -3,
  });
  assert.match(beforeDue, /Mang budi/);
  assert.match(beforeDue, /akan jatuh tempo/i);
  assert.match(beforeDue, /Rp75\.000/);

  const onDueDate = buildAutomaticBillingReminderMessage({
    ...baseRecipient,
    offsetDays: 0,
  });
  assert.match(onDueDate, /Hari ini adalah jatuh tempo/i);

  const afterDue = buildAutomaticBillingReminderMessage({
    ...baseRecipient,
    offsetDays: 3,
  });
  assert.match(afterDue, /telah melewati jatuh tempo/i);
  assert.match(afterDue, /Bayar SPP <nominal>/);
});

test("manual reminder message is generic and retains bill snapshot data", () => {
  const message = buildManualBillingReminderMessage({
    ...baseRecipient,
    billingName: "Iuran Makan",
    jenisKelamin: "P",
  });

  assert.match(message, /Teh budi/);
  assert.match(message, /pengingat tagihan Iuran Makan/i);
  assert.match(message, /Sisa tagihan: Rp75\.000/);
  assert.match(message, /Bayar Iuran Makan <nominal>/);
});

test("manual group reminder reports the accumulated current-period totals", () => {
  const message = buildManualGroupBillingReminderMessage({
    billingName: "Syahriah",
    periodStart: "2026-09-01",
    asOf: "2026-09-10",
    santriPaidCount: 10,
    santriTargetCount: 30,
    santriPaidAmount: 650000,
    santriahPaidCount: 22,
    santriahTargetCount: 46,
    santriahPaidAmount: 1430000,
    totalPaidCount: 32,
    totalPaidAmount: 2080000,
    totalUnpaidCount: 44,
    totalOutstandingAmount: 2860000,
  });

  assert.match(message, /Akumulasi pembayaran: 1 September 2026 s\.d\. 10 September 2026/);
  assert.match(message, /Santri yang sudah membayar : 10\/30/);
  assert.match(message, /Total uang masuk : Rp2\.080\.000/);
  assert.match(message, /Bayar Syahriah via MIFABOT/);
});

test("manual reminder group configuration accepts only a WhatsApp group JID", () => {
  assert.equal(
    validateManualReminderGroupJid("120363000000000000@g.us"),
    "120363000000000000@g.us",
  );
  assert.throws(
    () => validateManualReminderGroupJid("628123456789"),
    /ID grup WhatsApp tidak valid/,
  );
});

test("reminder offsets require unique signed integer day values", () => {
  assert.doesNotThrow(() => validateReminderOffsets([-7, -3, 0, 3]));
  assert.throws(() => validateReminderOffsets([-3, -3]), /duplikat/i);
  assert.throws(() => validateReminderOffsets([32_768]), /-32768 dan 32767/);
});
