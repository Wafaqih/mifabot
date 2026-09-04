import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isLocalProofStorageKey,
  LocalFileStorageProvider,
} from "../../src/integrations/storage/storage.js";

test("LocalFileStorageProvider stores arbitrary proof data without validating it", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mifabot-proof-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const storage = new LocalFileStorageProvider(directory);
  const data = Buffer.from("any uploaded content, including a non-payment photo");
  const key = await storage.put({
    data,
    contentType: "application/octet-stream",
    name: "proof-test",
  });

  assert.equal(isLocalProofStorageKey(key), true);
  assert.deepEqual(await storage.get(key), data);
  assert.equal(await storage.exists(key), true);

  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
});
