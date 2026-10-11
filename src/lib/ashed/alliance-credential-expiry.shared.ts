import {
  DEFAULT_EXPIRY_REMINDER_DAYS,
  daysUntil,
  isTokenExpired,
} from "@/lib/jwt/decode";

export type AllianceCredentialExpiryStage = "upcoming" | "expired";

export type AllianceCredentialBanner = {
  allianceTag: string;
  expired: boolean;
  expiresAtFormatted: string;
};

export const ALLIANCE_CREDENTIAL_REMINDER_DAYS = DEFAULT_EXPIRY_REMINDER_DAYS;

export function allianceCredentialExpiryStage(
  expiresAt: Date | null | undefined,
  now = new Date(),
  reminderDays = ALLIANCE_CREDENTIAL_REMINDER_DAYS,
): AllianceCredentialExpiryStage | null {
  if (!expiresAt) return null;
  if (isTokenExpired(expiresAt, now)) return "expired";
  return daysUntil(expiresAt, now) <= reminderDays ? "upcoming" : null;
}

/** Each token gets at most one `upcoming` and one `expired` notice. */
export function allianceCredentialNoticeDue(
  stage: AllianceCredentialExpiryStage | null,
  sentStage: AllianceCredentialExpiryStage | null | undefined,
): AllianceCredentialExpiryStage | null {
  if (!stage || stage === sentStage) return null;
  if (stage === "upcoming" && sentStage === "expired") return null;
  return stage;
}

export type AllianceCredentialRefreshDecision =
  | { refresh: true }
  | {
      refresh: false;
      reason:
        | "no_alliance_credential"
        | "no_new_expiry"
        | "new_token_expired"
        | "not_longer_lived"
        | "not_authorized";
    };

/**
 * Opportunistic refresh: replace the alliance bot token with an officer's
 * fresh session token only when it outlives the stored one and the officer may
 * own that slot (Ashed alliance owner, or the same person who installed it).
 */
export function decideAllianceCredentialRefresh(input: {
  hasAllianceCredential: boolean;
  storedExpiresAt: Date | null;
  newExpiresAt: Date | null;
  isAshedOwner: boolean;
  isSameRegistrant: boolean;
  isSameAshedIdentity: boolean;
  now?: Date;
}): AllianceCredentialRefreshDecision {
  if (!input.hasAllianceCredential) {
    return { refresh: false, reason: "no_alliance_credential" };
  }
  if (!input.newExpiresAt) return { refresh: false, reason: "no_new_expiry" };
  if (isTokenExpired(input.newExpiresAt, input.now ?? new Date())) {
    return { refresh: false, reason: "new_token_expired" };
  }
  if (
    input.storedExpiresAt &&
    input.newExpiresAt.getTime() <= input.storedExpiresAt.getTime()
  ) {
    return { refresh: false, reason: "not_longer_lived" };
  }
  if (!input.isAshedOwner && !input.isSameRegistrant && !input.isSameAshedIdentity) {
    return { refresh: false, reason: "not_authorized" };
  }
  return { refresh: true };
}

/** True when a decoded Ashed JWT payload names the given Ashed user. */
export function jwtPayloadMatchesAshedUser(
  payload: Record<string, unknown> | null,
  user: { id?: string | null; email?: string | null },
): boolean {
  if (!payload) return false;
  const id = user.id?.trim();
  const email = user.email?.trim().toLowerCase();
  for (const key of ["sub", "user_id", "userId", "id"]) {
    const value = payload[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (id && value.trim() === id) return true;
    if (email && value.trim().toLowerCase() === email) return true;
  }
  const claimEmail = payload.email;
  return Boolean(
    email && typeof claimEmail === "string" && claimEmail.trim().toLowerCase() === email,
  );
}
