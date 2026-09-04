export type SelfProfileGender = "L" | "P";

export type SelfProfileRole = "USER" | "ADMIN" | "SUPER_ADMIN";

export type SelfProfileStatus = "AKTIF" | "NONAKTIF";

/**
 * A user record suitable for showing the result of a self-service change.
 * Billing details intentionally stay out of this shape; callers that need
 * them can load the active profile through the access module.
 */
export interface SelfProfile {
  id: string;
  fullName: string;
  username: string;
  phoneNumber: string;
  gender: SelfProfileGender;
  role: SelfProfileRole;
  status: SelfProfileStatus;
}

export interface RegisterSelfUserInput {
  /** WhatsApp number that sent the `Daftar` command. */
  senderPhoneNumber: string;
  fullName: string;
  username: string;
  phoneNumber: string;
  gender: string;
}

export type EditableSelfProfileField =
  | "fullName"
  | "username"
  | "phoneNumber"
  | "gender";

export interface UpdateOwnProfileInput {
  /**
   * Identity of the authenticated sender.  There is deliberately no target
   * user id in this API, so callers cannot use it to edit another account.
   */
  userId: string;
  field: EditableSelfProfileField;
  value: string;
}

export class SelfProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfProfileValidationError";
  }
}

export class SelfProfileConflictError extends Error {
  constructor(
    readonly field: "username" | "phoneNumber",
    message: string,
  ) {
    super(message);
    this.name = "SelfProfileConflictError";
  }
}

export class SelfProfileNotFoundError extends Error {
  constructor() {
    super("Profil pengguna tidak ditemukan.");
    this.name = "SelfProfileNotFoundError";
  }
}
