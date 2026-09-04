import {
  findActiveUserByWhatsAppNumber,
  findActiveUserRoleByWhatsAppNumber,
} from "./access.repository.js";
import type { ActiveUser } from "./access.repository.js";
import { isRootAuthorization } from "./access.service.js";
import { buildHelpMessage } from "./help.message.js";

export async function getHelpForWhatsAppNumber(
  phoneNumber: string,
): Promise<string> {
  // Resolve the configured root before relying on a users record.
  const role = isRootAuthorization(phoneNumber)
    ? "SUPER_ADMIN"
    : await findActiveUserRoleByWhatsAppNumber(phoneNumber);
  return buildHelpMessage(role);
}

export async function getActiveUserForWhatsAppNumber(
  phoneNumber: string,
): Promise<ActiveUser | null> {
  return findActiveUserByWhatsAppNumber(phoneNumber);
}
