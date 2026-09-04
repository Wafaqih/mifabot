import "dotenv/config";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi.`);
  }

  return value;
}

const storageDriver = (process.env.STORAGE_DRIVER ?? "GOOGLE_DRIVE")
  .trim()
  .toUpperCase();
if (storageDriver !== "LOCAL") {
  throw new Error("STORAGE_DRIVER untuk MIFABOT harus bernilai LOCAL.");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  timezone: process.env.APP_TIMEZONE ?? "Asia/Jakarta",
  databaseUrl: required("DATABASE_URL"),
  baileysAuthDir: path.resolve(required("BAILEYS_AUTH_DIR")),
  storageDriver,
  localProofStorageDirectory: path.resolve(
    process.env.LOCAL_PROOF_STORAGE_DIR ?? "./storage/payment-proofs",
  ),
  superAdminWhatsapp: required("SUPER_ADMIN_WHATSAPP"),
} as const;
