import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import {
  canReviewMemberLinks,
  canManageInvitesAndOnboarding,
} from "@/lib/member-link/invite-onboarding-access.server";
import { createOnboardingReviewAfterSelfServiceLink } from "@/lib/member-link/onboarding-review.server";
import { createNativeAllianceMemberForRosterLink } from "@/lib/member-link/roster-member-create.server";
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

const INVITE_MEMBER_LINK_KINDS = ["email", "protected_link"] as const;

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
  | { ok: false; reason: "not_eligible" | "roster_full" | "member_taken" };

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

export async function isInviteGatedMemberLink(input: {
  allianceId: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<{
  gated: boolean;
  inviteId?: string | null;
  joinCodeId?: string | null;
}> {
  let hqUserId = input.hqUserId?.trim() || null;
  if (!hqUserId && input.discordUserId) {
    const { getDiscordHqLink } = await import("@/lib/vr/repository");
    const link = await getDiscordHqLink(input.discordUserId);
    hqUserId = link?.hqUserId ?? null;
  }
  if (!hqUserId) {
    return { gated: false };
  }

  const db = getDb();

  const [invite] = await db
    .select({ id: schema.hqInvites.id })
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.allianceId, input.allianceId),
        eq(schema.hqInvites.acceptedByHqUserId, hqUserId),
        isNotNull(schema.hqInvites.acceptedAt),
        isNull(schema.hqInvites.targetAshedMemberId),
        inArray(schema.hqInvites.kind, [...INVITE_MEMBER_LINK_KINDS]),
      ),
    )
    .orderBy(desc(schema.hqInvites.acceptedAt))
    .limit(1);

  if (invite) {
    return { gated: true, inviteId: invite.id, joinCodeId: null };
  }

  const [joinCode] = await db
    .select({
      joinCodeId: schema.hqAllianceJoinCodeRedemptions.joinCodeId,
    })
    .from(schema.hqAllianceJoinCodeRedemptions)
    .innerJoin(
      schema.hqAllianceJoinCodes,
      eq(
        schema.hqAllianceJoinCodeRedemptions.joinCodeId,
        schema.hqAllianceJoinCodes.id,
      ),
    )
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.allianceId, input.allianceId),
        eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, hqUserId),
        isNull(schema.hqAllianceJoinCodes.targetAshedMemberId),
      ),
    )
    .orderBy(desc(schema.hqAllianceJoinCodeRedemptions.redeemedAt))
    .limit(1);

  if (joinCode) {
    return { gated: true, inviteId: null, joinCodeId: joinCode.joinCodeId };
  }

  return { gated: false };
}

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
      return { ok: false, reason: "member_taken" };
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
    return { ok: false, reason: "member_taken" };
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
