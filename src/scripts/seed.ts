import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDatabasePool, databasePool } from "../core/database/pool.js";
import { logger } from "../core/logger/logger.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(
  currentDirectory,
  "../../database/seeds/001_development_seed.sql",
);

try {
  const sql = await readFile(seedPath, "utf8");
  await databasePool.query(sql);
  logger.info({ seed: path.basename(seedPath) }, "Seed development selesai.");
} catch (error: unknown) {
  logger.error({ error }, "Seed development gagal.");
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
