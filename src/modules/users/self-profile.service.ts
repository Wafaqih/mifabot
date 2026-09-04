import { databasePool, withTransaction } from "../../core/database/pool.js";
import { env } from "../../config/env.js";
import { normalizeWhatsAppNumber } from "../access/access.service.js";
import { ensureCurrentBillsForUserInTransaction } from "../billing/billing.service.js";
import {
  findSelfProfileById,
  findUserByUsernameCaseInsensitive,
  findUserByWhatsAppNumberIncludingInactive,
  findUserRoleId,
  insertSelfRegisteredUser,
  lockSelfProfileIdentity,
  updateSelfProfileField,
} from "./self-profile.repository.js";
import {
  SelfProfileConflictError,
  SelfProfileNotFoundError,
  SelfProfileValidationError,
  type EditableSelfProfileField,
  type RegisterSelfUserInput,
  type SelfProfile,
  type SelfProfileGender,
  type UpdateOwnProfileInput,
} from "./self-profile.types.js";

export {
  SelfProfileConflictError,
  SelfProfileNotFoundError,
  SelfProfileValidationError,
} from "./self-profile.types.js";

const usernamePattern = /^[a-zA-Z0-9._-]{3,60}$/;
const phoneNumberPattern = /^[1-9][0-9]{7,14}$/;

function currentDateInAppTimezone(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function asText(value: string): string {
  return value.trim();
}

/** Normalize a WhatsApp phone number and enforce the users-table format. */
export function normalizeSelfProfilePhoneNumber(value: string): string | null {
  const normalized = normalizeWhatsAppNumber(value);
  return normalized && phoneNumberPattern.test(normalized) ? normalized : null;
}

export function normalizeSelfProfileFullName(value: string): string {
  const fullName = asText(value).replace(/\s+/g, " ");
  if (!fullName || fullName.length > 200) {
    throw new SelfProfileValidationError(
      "Nama lengkap wajib diisi dan maksimal 200 karakter.",
    );
  }
  return fullName;
}

export function normalizeSelfProfileUsername(value: string): string {
  const username = asText(value);
  if (!usernamePattern.test(username)) {
    throw new SelfProfileValidationError(
      "Username harus 3-60 karakter dan hanya boleh berisi huruf, angka, titik, strip, atau underscore.",
    );
  }
  return username;
}

export function normalizeSelfProfileGender(value: string): SelfProfileGender {
  const normalized = asText(value).toLowerCase().replace(/[^a-z]/g, "");
  if (["l", "laki", "lakilaki"].includes(normalized)) return "L";
  if (["p", "perempuan", "wanita"].includes(normalized)) return "P";
  throw new SelfProfileValidationError("Jenis kelamin harus L atau P.");
}

export function requireSelfProfilePhoneNumber(value: string): string {
  const phoneNumber = normalizeSelfProfilePhoneNumber(value);
  if (!phoneNumber) {
    throw new SelfProfileValidationError("Nomor WhatsApp tidak valid.");
  }
  return phoneNumber;
}

function ensureEditableField(value: string): asserts value is EditableSelfProfileField {
  if (!(["fullName", "username", "phoneNumber", "gender"] as const).includes(
    value as EditableSelfProfileField,
  )) {
    throw new SelfProfileValidationError("Bagian profil yang ingin diubah tidak valid.");
  }
}

/**
 * Return whether the number belongs to any record, including an inactive
 * account. This lets the WhatsApp flow reject `Daftar` before collecting data;
 * `registerSelfUser` repeats the check transactionally before it writes.
 */
export async function isWhatsAppNumberRegistered(
  phoneNumber: string,
): Promise<boolean> {
  const normalizedPhoneNumber = normalizeSelfProfilePhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) return false;
  const user = await findUserByWhatsAppNumberIncludingInactive(
    databasePool,
    normalizedPhoneNumber,
  );
  return user !== null;
}

export async function registerSelfUser(
  input: RegisterSelfUserInput,
): Promise<SelfProfile> {
  const senderPhoneNumber = requireSelfProfilePhoneNumber(input.senderPhoneNumber);
  const phoneNumber = requireSelfProfilePhoneNumber(input.phoneNumber);
  if (senderPhoneNumber !== phoneNumber) {
    throw new SelfProfileValidationError(
      "Nomor WhatsApp harus sama dengan nomor yang digunakan untuk mengirim perintah Daftar.",
    );
  }

  const fullName = normalizeSelfProfileFullName(input.fullName);
  const username = normalizeSelfProfileUsername(input.username);
  const gender = normalizeSelfProfileGender(input.gender);
  const asOf = currentDateInAppTimezone();

  return withTransaction(async (client) => {
    const identityLocks = [
      `self-profile:phone:${phoneNumber}`,
      `self-profile:username:${username.toLowerCase()}`,
    ].sort();
    for (const identityLock of identityLocks) {
      await lockSelfProfileIdentity(client, identityLock);
    }

    const [phoneOwner, usernameOwner] = await Promise.all([
      findUserByWhatsAppNumberIncludingInactive(client, phoneNumber, { forUpdate: true }),
      findUserByUsernameCaseInsensitive(client, username, { forUpdate: true }),
    ]);
    if (phoneOwner) {
      throw new SelfProfileConflictError(
        "phoneNumber",
        "Nomor WhatsApp ini sudah terdaftar.",
      );
    }
    if (usernameOwner) {
      throw new SelfProfileConflictError(
        "username",
        "Username sudah terdaftar. Silakan pilih username lain.",
      );
    }

    const userRoleId = await findUserRoleId(client, "USER");
    const profile = await insertSelfRegisteredUser(client, {
      userRoleId,
      fullName,
      username,
      phoneNumber,
      gender,
    });
    await ensureCurrentBillsForUserInTransaction(client, {
      userId: profile.id,
      asOf,
    });
    return profile;
  });
}

/**
 * Edit one field on the authenticated user's own profile. Role and status are
 * intentionally absent from the update mapping, so this path cannot change
 * authorization or account activation.
 */
export async function updateOwnProfile(
  input: UpdateOwnProfileInput,
): Promise<SelfProfile> {
  if (!input.userId.trim()) {
    throw new SelfProfileValidationError("Profil pengguna tidak valid.");
  }
  ensureEditableField(input.field);

  return withTransaction(async (client) => {
    const ownProfile = await findSelfProfileById(client, input.userId);
    if (!ownProfile) throw new SelfProfileNotFoundError();

    switch (input.field) {
      case "fullName": {
        const updated = await updateSelfProfileField(client, {
          userId: ownProfile.id,
          field: "nama_lengkap",
          value: normalizeSelfProfileFullName(input.value),
        });
        if (!updated) throw new SelfProfileNotFoundError();
        return updated;
      }
      case "gender": {
        const updated = await updateSelfProfileField(client, {
          userId: ownProfile.id,
          field: "jenis_kelamin",
          value: normalizeSelfProfileGender(input.value),
        });
        if (!updated) throw new SelfProfileNotFoundError();
        return updated;
      }
      case "username": {
        const username = normalizeSelfProfileUsername(input.value);
        await lockSelfProfileIdentity(client, `self-profile:username:${username.toLowerCase()}`);
        const owner = await findUserByUsernameCaseInsensitive(client, username, { forUpdate: true });
        if (owner && owner.id !== ownProfile.id) {
          throw new SelfProfileConflictError(
            "username",
            "Username sudah terdaftar. Silakan pilih username lain.",
          );
        }
        const updated = await updateSelfProfileField(client, {
          userId: ownProfile.id,
          field: "username",
          value: username,
        });
        if (!updated) throw new SelfProfileNotFoundError();
        return updated;
      }
      case "phoneNumber": {
        const phoneNumber = requireSelfProfilePhoneNumber(input.value);
        await lockSelfProfileIdentity(client, `self-profile:phone:${phoneNumber}`);
        const owner = await findUserByWhatsAppNumberIncludingInactive(client, phoneNumber, { forUpdate: true });
        if (owner && owner.id !== ownProfile.id) {
          throw new SelfProfileConflictError(
            "phoneNumber",
            "Nomor WhatsApp ini sudah terdaftar.",
          );
        }
        const updated = await updateSelfProfileField(client, {
          userId: ownProfile.id,
          field: "nomor_whatsapp",
          value: phoneNumber,
        });
        if (!updated) throw new SelfProfileNotFoundError();
        return updated;
      }
    }
  });
}
