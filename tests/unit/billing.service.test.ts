import test from "node:test";
import assert from "node:assert/strict";

import {
  currentRecurringPeriodForDate,
  initialBillingRateEffectiveDate,
  nextNominalEffectiveDate,
  scheduledPeriodForDate,
  summarizeArrears,
} from "../../src/modules/billing/billing.service.js";
import type { Bill } from "../../src/modules/billing/billing.types.js";

function bill(
  billingDefinitionId: string,
  billingName: string,
  sisa: number,
): Bill {
  return {
    id: `${billingDefinitionId}-${sisa}`,
    userId: "user-1",
    billingDefinitionId,
    billingName,
    tariffId: null,
    periodeMulai: "2026-07-01",
    periodeSelesai: "2026-07-31",
    jatuhTempo: "2026-07-01",
    nominal: sisa,
    status: "BELUM_BAYAR",
    totalDibayar: 0,
    sisa,
  };
}

test("summarizeArrears groups bills by billing definition and sums outstanding amounts", () => {
  const result = summarizeArrears([
    bill("definition-spp", "SPP", 65000),
    bill("definition-spp", "SPP", 120000),
    bill("definition-makan", "Iuran Makan", 50000),
  ]);

  assert.deepEqual(result, [
    {
      billingDefinitionId: "definition-spp",
      billingName: "SPP",
      jumlahBill: 2,
      totalSisa: 185000,
    },
    {
      billingDefinitionId: "definition-makan",
      billingName: "Iuran Makan",
      jumlahBill: 1,
      totalSisa: 50000,
    },
  ]);
});

test("summarizeArrears returns an empty list without arrears", () => {
  assert.deepEqual(summarizeArrears([]), []);
});

test("nominal changes begin on the next matching recurring period", () => {
  assert.equal(nextNominalEffectiveDate("WEEKLY", "2026-08-31"), "2026-09-07");
  assert.equal(nextNominalEffectiveDate("MONTHLY", "2026-08-31"), "2026-09-01");
  assert.equal(nextNominalEffectiveDate("YEARLY", "2026-08-31"), "2027-01-01");
  assert.equal(nextNominalEffectiveDate("CUSTOM", "2026-08-31"), "2026-09-01");
});

test("initial recurring nominal covers the full active period", () => {
  assert.equal(initialBillingRateEffectiveDate("WEEKLY", "2026-09-02"), "2026-08-31");
  assert.equal(initialBillingRateEffectiveDate("MONTHLY", "2026-09-10"), "2026-09-01");
  assert.equal(initialBillingRateEffectiveDate("YEARLY", "2026-09-10"), "2026-01-01");
  assert.equal(initialBillingRateEffectiveDate("CUSTOM", "2026-09-10"), "2026-09-10");
});

test("scheduled period skips custom definitions", () => {
  assert.equal(scheduledPeriodForDate("CUSTOM", "2026-09-01"), null);
  assert.deepEqual(scheduledPeriodForDate("MONTHLY", "2026-09-01"), {
    periodeMulai: "2026-09-01",
    periodeSelesai: "2026-09-30",
    jatuhTempo: "2026-09-05",
  });
});

test("current recurring period supports catch-up after its first day", () => {
  assert.deepEqual(currentRecurringPeriodForDate("MONTHLY", "2026-09-02"), {
    periodeMulai: "2026-09-01",
    periodeSelesai: "2026-09-30",
    jatuhTempo: "2026-09-05",
  });
  assert.deepEqual(currentRecurringPeriodForDate("WEEKLY", "2026-09-02"), {
    periodeMulai: "2026-08-31",
    periodeSelesai: "2026-09-06",
    jatuhTempo: "2026-09-04",
  });
  assert.equal(currentRecurringPeriodForDate("CUSTOM", "2026-09-02"), null);
});
