import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateArrearsPayment,
  validateNominal,
  validateProof,
} from "../../src/modules/payments/payment.service.js";

test("validateNominal accepts positive safe integers", () => {
  assert.doesNotThrow(() => validateNominal(65000));
});

test("validateNominal rejects zero, decimals, and unsafe values", () => {
  assert.throws(() => validateNominal(0));
  assert.throws(() => validateNominal(65000.5));
  assert.throws(() => validateNominal(Number.MAX_SAFE_INTEGER + 1));
});

test("arrears installments are allocated from the oldest selected bill", () => {
  assert.deepEqual(
    allocateArrearsPayment(50000, [
      { billId: "juli", nominalWajib: 30000 },
      { billId: "agustus", nominalWajib: 40000 },
    ]),
    [
      { billId: "juli", nominal: 30000 },
      { billId: "agustus", nominal: 20000 },
    ],
  );
  assert.throws(() =>
    allocateArrearsPayment(70001, [
      { billId: "juli", nominalWajib: 30000 },
      { billId: "agustus", nominalWajib: 40000 },
    ]),
  );
});

test("validateProof allows cash without a proof", () => {
  assert.doesNotThrow(() => validateProof(null, "CASH"));
  assert.doesNotThrow(() => validateProof("proof/key.jpg", "DANA"));
});

test("validateProof requires proof for non-cash methods", () => {
  assert.throws(() => validateProof(null, "DANA"));
  assert.throws(() => validateProof(undefined, "BANK_TRANSFER"));
});
