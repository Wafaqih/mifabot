import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSelfProfileFullName,
  normalizeSelfProfileGender,
  normalizeSelfProfilePhoneNumber,
  normalizeSelfProfileUsername,
  registerSelfUser,
  requireSelfProfilePhoneNumber,
  SelfProfileValidationError,
} from "../../src/modules/users/self-profile.service.js";

test("self-registration normalizes a full name without losing its words", () => {
  assert.equal(
    normalizeSelfProfileFullName("  Ahmad   Fauzi  "),
    "Ahmad Fauzi",
  );
  assert.throws(
    () => normalizeSelfProfileFullName("   "),
    SelfProfileValidationError,
  );
});

test("self-registration validates the username format and preserves its spelling", () => {
  assert.equal(normalizeSelfProfileUsername("Ahmad.Fauzi_1"), "Ahmad.Fauzi_1");
  assert.throws(
    () => normalizeSelfProfileUsername("ahmad fauzi"),
    SelfProfileValidationError,
  );
  assert.throws(
    () => normalizeSelfProfileUsername("ab"),
    SelfProfileValidationError,
  );
});

test("self-profile phone validation normalizes common Indonesian formats", () => {
  assert.equal(
    normalizeSelfProfilePhoneNumber("0812-3456-7890"),
    "6281234567890",
  );
  assert.equal(
    normalizeSelfProfilePhoneNumber("81234567890"),
    "6281234567890",
  );
  assert.equal(normalizeSelfProfilePhoneNumber("123"), null);
  assert.throws(
    () => requireSelfProfilePhoneNumber("123"),
    SelfProfileValidationError,
  );
});

test("self-registration accepts L/P gender values and common Indonesian labels", () => {
  assert.equal(normalizeSelfProfileGender("L"), "L");
  assert.equal(normalizeSelfProfileGender("laki-laki"), "L");
  assert.equal(normalizeSelfProfileGender("Perempuan"), "P");
  assert.equal(normalizeSelfProfileGender("wanita"), "P");
  assert.throws(
    () => normalizeSelfProfileGender("lainnya"),
    SelfProfileValidationError,
  );
});

test("self-registration refuses a phone number that differs from the command sender", async () => {
  await assert.rejects(
    () => registerSelfUser({
      senderPhoneNumber: "628121000001",
      fullName: "Budi Santoso",
      username: "budi",
      phoneNumber: "628121000002",
      gender: "L",
    }),
    SelfProfileValidationError,
  );
});
