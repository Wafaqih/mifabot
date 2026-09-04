import assert from "node:assert/strict";
import test from "node:test";

import { buildProfileMessage } from "../../src/modules/access/profile.message.js";
import { buildBillsMessage } from "../../src/modules/billing/billing.message.js";
import type { ActiveUser } from "../../src/modules/access/access.repository.js";
import type { Bill } from "../../src/modules/billing/billing.types.js";

const user: ActiveUser = {
  id: "user-1",
  role: "USER",
  namaLengkap: "Budi Santoso",
  username: "budi",
  jenisKelamin: "L",
  nomorWhatsapp: "628121000001",
  billingRates: [
    { billingDefinitionId: "definition-spp", billingName: "SPP", nominal: 65000 },
    { billingDefinitionId: "definition-makan", billingName: "Iuran Makan", nominal: 25000 },
  ],
};

function bill(overrides: Partial<Bill>): Bill {
  return {
    id: "bill-1",
    userId: "user-1",
    billingDefinitionId: "definition-spp",
    billingName: "SPP",
    tariffId: null,
    periodeMulai: "2026-08-01",
    periodeSelesai: "2026-08-31",
    jatuhTempo: "2026-08-01",
    nominal: 65000,
    status: "CICIL",
    totalDibayar: 30000,
    sisa: 35000,
    ...overrides,
  };
}

test("buildProfileMessage includes greeting, identity, and dynamic billing rates", () => {
  const message = buildProfileMessage(user);

  assert.match(message, /Assalamu'alaikum Mang budi!/);
  assert.match(message, /Nama\s+: Budi Santoso/);
  assert.match(message, /SPP\s+: Rp65\.000/);
  assert.match(message, /Iuran Makan\s+: Rp25\.000/);
});

test("buildBillsMessage includes current bill and arrears", () => {
  const message = buildBillsMessage(
    user,
    [bill({})],
    [
      bill({
        id: "bill-old",
        periodeMulai: "2026-07-01",
        periodeSelesai: "2026-07-31",
        sisa: 65000,
      }),
    ],
  );

  assert.match(message, /TAGIHAN BERJALAN/);
  assert.match(message, /Dibayar\s+: Rp30\.000/);
  assert.match(message, /Sisa\s+: Rp35\.000/);
  assert.match(message, /Total tunggakan: Rp65\.000/);
});

test("buildBillsMessage explains when there is nothing left to pay", () => {
  const message = buildBillsMessage(user, [], []);

  assert.match(message, /Belum ada tagihan aktif.*seluruhnya sudah lunas/i);
  assert.match(message, /Tidak ada tunggakan/i);
});
