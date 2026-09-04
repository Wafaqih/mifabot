import assert from "node:assert/strict";
import test from "node:test";

import { env } from "../../src/config/env.js";
import {
  isRootAuthorization,
  normalizeWhatsAppNumber,
} from "../../src/modules/access/access.service.js";

test("normalizes local and international WhatsApp number formats", () => {
  assert.equal(normalizeWhatsAppNumber("0812-3456-7890"), "6281234567890");
  assert.equal(normalizeWhatsAppNumber("+62 812 3456 7890"), "6281234567890");
  assert.equal(normalizeWhatsAppNumber("81234567890"), "6281234567890");
});

test("configured WhatsApp number is root authorization without a users lookup", () => {
  assert.equal(isRootAuthorization(env.superAdminWhatsapp), true);
  assert.equal(isRootAuthorization(`0${env.superAdminWhatsapp.slice(2)}`), true);
});

test("different WhatsApp number is not root authorization", () => {
  assert.equal(isRootAuthorization("6281234567890"), false);
});

test("root authorization remains independent from a database user role", () => {
  const rootNumber = env.superAdminWhatsapp;
  const databaseUserRole = "USER";

  assert.equal(isRootAuthorization(rootNumber), true);
  assert.equal(databaseUserRole, "USER");
});