import { env } from "../../config/env.js";

/**
 * Normalize the phone formats commonly used in WhatsApp and MIFABOT data.
 * Database records use the international digits-only representation.
 */
export function normalizeWhatsAppNumber(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/**
 * Root authorization is configuration-based and deliberately independent
 * from the users table.
 */
export function isRootAuthorization(whatsappNumber: string): boolean {
  const incoming = normalizeWhatsAppNumber(whatsappNumber);
  const configuredRoot = normalizeWhatsAppNumber(env.superAdminWhatsapp);

  return incoming !== null && configuredRoot !== null && incoming === configuredRoot;
}