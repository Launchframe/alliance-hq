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

/** Pure native-alliance ownership proof for guild registration (no Ashed credentials).
 *  A native-alliance owner proves ownership with a Discord member link whose in-game
 *  member id matches the alliance ownerMemberExternalId. Non-native (Ashed-sourced)
 *  alliances must use the credential-gated owner check instead. */
export function nativeOwnerProvenByMemberLink(input: {
  isNative: boolean;
  ownerMemberExternalId: string | null;
  linkedMemberIds: readonly string[];
}): boolean {
  if (!input.isNative) return false;
  if (!input.ownerMemberExternalId) return false;
  return input.linkedMemberIds.includes(input.ownerMemberExternalId);
}

/** Pure eligibility check for `/link-alliance` (unit-testable). */
export function evaluateGuildRegistrationAuth(input: {
  hasHqLink: boolean;
  isPlatformMaintainer: boolean;
  isCredentialRegistrant: boolean;
  isOwnerViaMemberLink: boolean;
  ownerAshedUserId: string | null;
  linkedHqAshedUserId: string | null;
  hasCredentials: boolean;
}): GuildRegistrationAuth {
  if (input.isPlatformMaintainer) {
    return { allowed: true, registeredBy: "platform_maintainer" };
  }
  if (input.isOwnerViaMemberLink) {
    return { allowed: true, registeredBy: "alliance_owner" };
  }
  if (!input.hasCredentials) {
    return { allowed: false, reason: "no_credentials" };
  }
  if (input.isCredentialRegistrant) {
    return { allowed: true, registeredBy: "credential_registrant" };
  }
  if (!input.hasHqLink) {
    return { allowed: false, reason: "no_hq_link" };
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
