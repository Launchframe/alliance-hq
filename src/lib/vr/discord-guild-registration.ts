export type DiscordAuthNoncePurpose = "alliance_credentials" | "user_link";

export type GuildRegistrationDenialReason =
  | "no_hq_link"
  | "no_credentials"
  | "not_owner";

export type GuildRegistrationAuth =
  | {
      allowed: true;
      registeredBy: "platform_maintainer" | "alliance_owner" | "credential_registrant";
    }
  | { allowed: false; reason: GuildRegistrationDenialReason };

/** Pure eligibility check for `/link-alliance` (unit-testable). */
export function evaluateGuildRegistrationAuth(input: {
  hasHqLink: boolean;
  isPlatformMaintainer: boolean;
  isCredentialRegistrant: boolean;
  ownerAshedUserId: string | null;
  linkedHqAshedUserId: string | null;
  hasCredentials: boolean;
}): GuildRegistrationAuth {
  if (!input.hasHqLink) {
    return { allowed: false, reason: "no_hq_link" };
  }
  if (input.isPlatformMaintainer) {
    return { allowed: true, registeredBy: "platform_maintainer" };
  }
  if (!input.hasCredentials) {
    return { allowed: false, reason: "no_credentials" };
  }
  if (input.isCredentialRegistrant) {
    return { allowed: true, registeredBy: "credential_registrant" };
  }
  if (
    input.ownerAshedUserId &&
    input.linkedHqAshedUserId &&
    input.linkedHqAshedUserId === input.ownerAshedUserId
  ) {
    return { allowed: true, registeredBy: "alliance_owner" };
  }
  return { allowed: false, reason: "not_owner" };
}
