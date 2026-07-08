export type DiscordAuthNoncePurpose =
  | "alliance_credentials"
  | "user_link"
  | "member_link";

export type GuildRegistrationDenialReason =
  | "no_hq_link"
  | "no_credentials"
  | "not_owner";

export type GuildRegistrationAuth =
  | {
      allowed: true;
      registeredBy:
        | "platform_maintainer"
        | "alliance_owner"
        | "alliance_officer"
        | "credential_registrant";
    }
  | { allowed: false; reason: GuildRegistrationDenialReason };

/** Pure alliance ownership proof for guild registration (no Ashed credentials).
 *  An alliance owner proves ownership with a Discord member link whose in-game
 *  member id matches the alliance ownerMemberExternalId. */
export function ownerProvenByMemberLink(input: {
  allianceExists: boolean;
  ownerMemberExternalId: string | null;
  linkedMemberIds: readonly string[];
}): boolean {
  if (!input.allianceExists) return false;
  if (!input.ownerMemberExternalId) return false;
  return input.linkedMemberIds.includes(input.ownerMemberExternalId);
}

/** Pure, conservative native-owner claim from a Discord member link.
 *
 *  Closes the Discord-only owner gap: an owner who never completed HQ-web
 *  onboarding has no `ownerMemberExternalId` set, so `/link-alliance` owner
 *  proof fails. We can safely claim ownership from Discord ONLY when the link
 *  is unambiguous — the alliance is native, no owner member is recorded yet,
 *  and the linked commander is the sole active R5 in the local roster.
 *
 *  Returns the ashedMemberId to persist as the owner, or null to claim nothing.
 *  Never claims for Ashed-sourced alliances, when an owner is already set, or
 *  when the R5 set is empty or ambiguous (multiple R5s). */
export function nativeOwnerClaimMemberId(input: {
  isNative: boolean;
  ownerAlreadySet: boolean;
  linkedAshedMemberId: string;
  activeR5MemberIds: readonly string[];
}): string | null {
  if (!input.isNative) return null;
  if (input.ownerAlreadySet) return null;
  if (input.activeR5MemberIds.length !== 1) return null;
  const soleActiveR5 = input.activeR5MemberIds[0]!;
  if (soleActiveR5 !== input.linkedAshedMemberId) return null;
  return soleActiveR5;
}

/** True when any linked commander has in-game alliance rank R4 or higher. */
export function officerProvenByMemberRanks(
  linkedMemberRanks: readonly number[],
): boolean {
  return linkedMemberRanks.some((rank) => rank >= 4);
}

/** Pure eligibility check for `/link-alliance` (unit-testable). */
export function evaluateGuildRegistrationAuth(input: {
  hasHqLink: boolean;
  isPlatformMaintainer: boolean;
  isCredentialRegistrant: boolean;
  isOwnerViaMemberLink: boolean;
  isOfficerViaMemberLink: boolean;
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
  if (input.isOfficerViaMemberLink) {
    return { allowed: true, registeredBy: "alliance_officer" };
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
