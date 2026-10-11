import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import { parseGameServerNumberFromUid } from "@/lib/lastwar/player-lookup";
import {
  canReviewMemberLinks,
  canManageInvitesAndOnboarding,
} from "@/lib/member-link/invite-onboarding-access.server";
import { isInviteGatedMemberLink } from "@/lib/member-link/invite-gate.server";
import { createOnboardingReviewAfterSelfServiceLink } from "@/lib/member-link/onboarding-review.server";
import { createNativeAllianceMemberForRosterLink } from "@/lib/member-link/roster-member-create.server";
import { resolveMemberLinkServerEligibilityForUid } from "@/lib/member-link/server-eligibility.server";
import {
  canCreateRosterMemberDuringOnboarding,
  countActiveRosterMembers,
  isSelfServiceOnboardingEnabled,
  parseInviteOnboardingMinRole,
} from "@/lib/member-link/self-service-onboarding.shared";
import { getRbacContext } from "@/lib/rbac/context";
import {
  findExactMemberByName,
  findUniqueSubstringRosterCandidate,
} from "@/lib/vr/link-helpers";
import type { AshedMember } from "@/lib/video/member-matcher";

export type MemberOnboardingSettings = {
  selfServiceOnboardingEnabled: boolean;
  inviteOnboardingMinRole: "officer" | "owner";
  activeMemberCount: number;
  canCreateRosterMembersDuringOnboarding: boolean;
  canManage: boolean;
  canManageInvitesAndOnboarding: boolean;
  canReviewMemberLinks: boolean;
};

export type SelfServiceLinkResult =
  | {
      ok: true;
      ashedMemberId: string;
      memberDisplayName: string;
      reviewCreated: boolean;
    }
  | {
      ok: false;
      reason:
        | "not_eligible"
        | "roster_full"
        | "member_taken"
        | "wrong_server"
        | "confirm_home"
        | "confirm_transfer"
        | "transfer_send_home"
        | "position_not_home";
      attemptedAshedMemberId?: string;
      lookupServer?: number;
      allianceServer?: number;
      knownServer?: number;
      commanderName?: string;
    };

export async function loadAllianceMemberOnboardingRow(allianceId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      selfServiceOnboardingEnabled: schema.alliances.selfServiceOnboardingEnabled,
      inviteOnboardingMinRole: schema.alliances.inviteOnboardingMinRole,
      ownerHqUserId: schema.alliances.ownerHqUserId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row ?? null;
}

export async function countAllianceActiveMembers(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ status: schema.allianceMembers.status })
    .from(schema.allianceMembers)
    .where(eq(schema.allianceMembers.allianceId, allianceId));
  return countActiveRosterMembers(rows);
}

export async function loadMemberOnboardingSettings(input: {
  allianceId: string;
  sessionId: string;
  hqUserId: string | null;
}): Promise<MemberOnboardingSettings | null> {
  const alliance = await loadAllianceMemberOnboardingRow(input.allianceId);
  if (!alliance) return null;

  const activeMemberCount = await countAllianceActiveMembers(input.allianceId);
  const ctx = await getRbacContext(input.sessionId);
  if (!ctx) return null;

  const canManage = input.hqUserId === alliance.ownerHqUserId;

  return {
    selfServiceOnboardingEnabled: isSelfServiceOnboardingEnabled(
      alliance.selfServiceOnboardingEnabled,
    ),
    inviteOnboardingMinRole: parseInviteOnboardingMinRole(
      alliance.inviteOnboardingMinRole,
    ),
    activeMemberCount,
    canCreateRosterMembersDuringOnboarding:
      canCreateRosterMemberDuringOnboarding(activeMemberCount),
    canManage,
    canManageInvitesAndOnboarding: canManageInvitesAndOnboarding(ctx, alliance),
    canReviewMemberLinks: canReviewMemberLinks(ctx, alliance),
  };
}

export async function saveMemberOnboardingSettings(input: {
  allianceId: string;
  ownerHqUserId: string;
  selfServiceOnboardingEnabled?: boolean;
  inviteOnboardingMinRole?: "officer" | "owner";
}): Promise<MemberOnboardingSettings | null> {
  const db = getDb();
  const now = new Date();
  const patch: Partial<typeof schema.alliances.$inferInsert> = {
    updatedAt: now,
  };
  if (input.selfServiceOnboardingEnabled !== undefined) {
    patch.selfServiceOnboardingEnabled = input.selfServiceOnboardingEnabled
      ? 1
      : 0;
  }
  if (input.inviteOnboardingMinRole !== undefined) {
    patch.inviteOnboardingMinRole = input.inviteOnboardingMinRole;
  }

  await db
    .update(schema.alliances)
    .set(patch)
    .where(
      and(
        eq(schema.alliances.id, input.allianceId),
        eq(schema.alliances.ownerHqUserId, input.ownerHqUserId),
      ),
    );

  const activeMemberCount = await countAllianceActiveMembers(input.allianceId);
  const alliance = await loadAllianceMemberOnboardingRow(input.allianceId);
  if (!alliance) return null;

  return {
    selfServiceOnboardingEnabled: isSelfServiceOnboardingEnabled(
      alliance.selfServiceOnboardingEnabled,
    ),
    inviteOnboardingMinRole: parseInviteOnboardingMinRole(
      alliance.inviteOnboardingMinRole,
    ),
    activeMemberCount,
    canCreateRosterMembersDuringOnboarding:
      canCreateRosterMemberDuringOnboarding(activeMemberCount),
    canManage: true,
    canManageInvitesAndOnboarding: true,
    canReviewMemberLinks: true,
  };
}

export { isInviteGatedMemberLink };

function findExactUnlinkedMember(
  members: AshedMember[],
  linkedMemberIds: Set<string>,
  gameUserName: string,
): AshedMember | null {
  const exact = findExactMemberByName(members, gameUserName);
  if (!exact || linkedMemberIds.has(exact.id)) {
    return null;
  }
  return exact;
}

export async function trySelfServiceMemberLink(input: {
  allianceId: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
  discordUsername?: string | null;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  members: AshedMember[];
  linkedMemberIds: Set<string>;
  origin: "web" | "discord";
  gameServerNumber?: number | null;
  allianceHomeConfirmed?: boolean;
  userClaimedLookupAsHome?: boolean;
  persistLink: (input: {
    ashedMemberId: string;
    memberDisplayName: string;
    gameUid: string;
    gameUserLevel?: number;
  }) => Promise<{ ok: true } | { ok: false; reason: "member_taken" }>;
}): Promise<SelfServiceLinkResult> {
  const alliance = await loadAllianceMemberOnboardingRow(input.allianceId);
  if (
    !alliance ||
    !isSelfServiceOnboardingEnabled(alliance.selfServiceOnboardingEnabled)
  ) {
    return { ok: false, reason: "not_eligible" };
  }

  const gate = await isInviteGatedMemberLink({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    discordUserId: input.discordUserId,
  });
  if (!gate.gated) {
    return { ok: false, reason: "not_eligible" };
  }

  const lookupServerNumber =
    input.lookup.gameServerNumber ??
    input.gameServerNumber ??
    parseGameServerNumberFromUid(input.gameUid);
  const serverEligibility = await resolveMemberLinkServerEligibilityForUid({
    allianceId: input.allianceId,
    gameUid: input.gameUid,
    lookupServer: lookupServerNumber,
    allianceHomeConfirmed: input.allianceHomeConfirmed,
    userClaimedLookupAsHome: input.userClaimedLookupAsHome,
    hqUserId: input.hqUserId,
    discordUserId: input.discordUserId,
  });
  if (serverEligibility.kind === "confirm_home") {
    return {
      ok: false,
      reason: "confirm_home",
      lookupServer: serverEligibility.lookupServer,
      allianceServer: serverEligibility.allianceServer,
      commanderName: input.lookup.gameUserName,
    };
  }
  if (serverEligibility.kind === "confirm_transfer") {
    return {
      ok: false,
      reason: "confirm_transfer",
      knownServer: serverEligibility.knownServer,
      allianceServer: serverEligibility.allianceServer,
      commanderName: input.lookup.gameUserName,
    };
  }
  if (serverEligibility.kind === "rejected") {
    if (serverEligibility.reason === "user_claimed_lookup_home") {
      return { ok: false, reason: "position_not_home" };
    }
    if (serverEligibility.reason === "transfer_position_mismatch") {
      return {
        ok: false,
        reason: "transfer_send_home",
        knownServer: serverEligibility.knownCommanderHomeServer ?? undefined,
        allianceServer: serverEligibility.allianceServer ?? undefined,
        commanderName: input.lookup.gameUserName,
      };
    }
    return { ok: false, reason: "wrong_server" };
  }

  const exact = findExactUnlinkedMember(
    input.members,
    input.linkedMemberIds,
    input.lookup.gameUserName,
  );
  if (exact) {
    const linked = await input.persistLink({
      ashedMemberId: exact.id,
      memberDisplayName: exact.current_name,
      gameUid: input.gameUid,
      ...(input.lookup.gameUserLevel != null
        ? { gameUserLevel: input.lookup.gameUserLevel }
        : {}),
    });
    if (!linked.ok) {
      return { ok: false, reason: "member_taken", attemptedAshedMemberId: exact.id };
    }
    return {
      ok: true,
      ashedMemberId: exact.id,
      memberDisplayName: exact.current_name,
      reviewCreated: false,
    };
  }

  const activeMemberCount = countActiveRosterMembers(input.members);
  if (!canCreateRosterMemberDuringOnboarding(activeMemberCount)) {
    return { ok: false, reason: "roster_full" };
  }

  const ashedMemberId = await createNativeAllianceMemberForRosterLink({
    allianceId: input.allianceId,
    gameUserName: input.lookup.gameUserName,
    gameUserLevel: input.lookup.gameUserLevel,
  });

  const linked = await input.persistLink({
    ashedMemberId,
    memberDisplayName: input.lookup.gameUserName,
    gameUid: input.gameUid,
    ...(input.lookup.gameUserLevel != null
      ? { gameUserLevel: input.lookup.gameUserLevel }
      : {}),
  });
  if (!linked.ok) {
    return {
      ok: false,
      reason: "member_taken",
      attemptedAshedMemberId: ashedMemberId,
    };
  }

  const suggestion = findUniqueSubstringRosterCandidate(
    input.members,
    input.lookup.gameUserName,
  );

  await createOnboardingReviewAfterSelfServiceLink({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId ?? null,
    inviteId: gate.inviteId ?? null,
    joinCodeId: gate.joinCodeId ?? null,
    origin: input.origin,
    discordUserId: input.discordUserId ?? null,
    discordUsername: input.discordUsername ?? null,
    linkedAshedMemberId: ashedMemberId,
    gameUid: input.gameUid,
    gameUserName: input.lookup.gameUserName,
    gameServerNumber: input.gameServerNumber ?? input.lookup.gameServerNumber ?? null,
    gameUserLevel: input.lookup.gameUserLevel ?? null,
    suggestedTargetAshedMemberId: suggestion?.ashedMemberId ?? null,
    suggestionMethod: suggestion?.method ?? null,
    suggestedMatchedRosterName: suggestion?.matchedRosterName ?? null,
  });

  return {
    ok: true,
    ashedMemberId,
    memberDisplayName: input.lookup.gameUserName,
    reviewCreated: true,
  };
}

export async function isSelfServiceEffectiveForAlliance(
  allianceId: string,
): Promise<boolean> {
  const alliance = await loadAllianceMemberOnboardingRow(allianceId);
  return alliance
    ? isSelfServiceOnboardingEnabled(alliance.selfServiceOnboardingEnabled)
    : false;
}
