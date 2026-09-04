import assert from "node:assert/strict";
import test from "node:test";

import type { WAMessage } from "@whiskeysockets/baileys";

import {
  getGroupId,
  getSenderPhoneNumber,
} from "../../src/integrations/whatsapp/message.js";

test("getGroupId returns the remote JID for a group message", () => {
  const message = {
    key: { remoteJid: "120363000000000000@g.us" },
  } as WAMessage;

  assert.equal(getGroupId(message), "120363000000000000@g.us");
});

test("getGroupId rejects a private conversation", () => {
  const message = {
    key: { remoteJid: "628121000001@s.whatsapp.net" },
  } as WAMessage;

  assert.equal(getGroupId(message), null);
});

test("getSenderPhoneNumber reads the alternate phone JID for a LID conversation", async () => {
  const message = {
    key: {
      remoteJid: "123456789012345@lid",
      remoteJidAlt: "6283824635228@s.whatsapp.net",
    },
  } as WAMessage;

  assert.equal(await getSenderPhoneNumber(message), "6283824635228");
});

test("getSenderPhoneNumber resolves a LID through the persisted Baileys mapping", async () => {
  const message = {
    key: { remoteJid: "123456789012345@lid" },
  } as WAMessage;

  const phoneNumber = await getSenderPhoneNumber(message, async (lidJid) => {
    assert.equal(lidJid, "123456789012345@lid");
    return "6283824635228:0@s.whatsapp.net";
  });

  assert.equal(phoneNumber, "6283824635228");
});

test("getSenderPhoneNumber ignores a LID when no phone JID is available", async () => {
  const message = {
    key: { remoteJid: "123456789012345@lid" },
  } as WAMessage;

  assert.equal(await getSenderPhoneNumber(message), null);
});
