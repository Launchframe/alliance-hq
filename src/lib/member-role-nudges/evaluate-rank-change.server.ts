import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { decideMemberRoleNudge } from "@/lib/member-role-nudges/decide.shared";
import {
  materializeMemberRoleNudgeInboxItem,
  satisfyMemberRoleNudgeInboxItem,
} from "@/lib/member-role-nudges/inbox.server";
import {
  crossedIntoOfficerRank,
  crossedOutOfOfficerRank,
  OFFICER_RANK,
  type MemberRoleNudgeKind,
} from "@/lib/member-role-nudges/types.shared";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

async function loadLinkedMembership(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<{
  hqUserId: string | null;
  roleName: string | null;
  hasActiveMembership: boolean;
}> {
  const db = getDb();
  const [link] = await db
    .select({
      hqUserId: schema.hqMemberLinks.hqUserId,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!link) {
    return { hqUserId: null, roleName: null, hasActiveMembership: false };
  }

  const [membership] = await db
    .select({
      roleId: schema.allianceMemberships.roleId,
      status: schema.allianceMemberships.status,
    })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, input.allianceId),
        eq(schema.allianceMemberships.hqUserId, link.hqUserId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!membership) {
    return {
      hqUserId: link.hqUserId,
      roleName: null,
      hasActiveMembership: false,
    };
  }

  return {
    hqUserId: link.hqUserId,
    roleName: systemRoleNameForId(membership.roleId),
    hasActiveMembership: true,
  };
}

async function loadRejectedKindsStillApplying(input: {
  allianceId: string;
  ashedMemberId: string;
  nextRank: number | null;
  hqRoleName: string | null;
  currentRankEventId: string | null;
}): Promise<Set<MemberRoleNudgeKind>> {
  const db = getDb();
  const rows = await db
    .select({
      kind: schema.memberRoleNudges.kind,
      status: schema.memberRoleNudges.status,
      toRank: schema.memberRoleNudges.toRank,
      fromRank: schema.memberRoleNudges.fromRank,
      rankEventId: schema.memberRoleNudges.rankEventId,
      createdAt: schema.memberRoleNudges.createdAt,
    })
    .from(schema.memberRoleNudges)
    .where(
      and(
        eq(schema.memberRoleNudges.allianceId, input.allianceId),
        eq(schema.memberRoleNudges.ashedMemberId, input.ashedMemberId),
        eq(schema.memberRoleNudges.status, "rejected"),
      ),
    )
    .orderBy(desc(schema.memberRoleNudges.createdAt));

  const seen = new Set<string>();
  const applying = new Set<MemberRoleNudgeKind>();

  for (const row of rows) {
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    const kind = row.kind as MemberRoleNudgeKind;

    if (
      row.rankEventId == null ||
      input.currentRankEventId == null ||
      row.rankEventId !== input.currentRankEventId
    ) {
      continue;
    }

    if (kind === "escalate_invite" || kind === "escalate_elevate") {
      if (
        input.nextRank === OFFICER_RANK &&
        (row.toRank === OFFICER_RANK || row.toRank == null)
      ) {
        applying.add(kind);
      }
      continue;
    }

    if (
      input.hqRoleName === "officer" &&
      input.nextRank != null &&
      input.nextRank < OFFICER_RANK &&
      (row.fromRank === OFFICER_RANK || row.fromRank == null)
    ) {
      applying.add("deescalate");
    }
  }

  return applying;
}

async function supersedeOpenNudges(input: {
  allianceId: string;
  ashedMemberId: string;
  kinds: MemberRoleNudgeKind[];
}): Promise<void> {
  if (input.kinds.length === 0) return;
  const db = getDb();
  const now = new Date();
  const open = await db
    .select({ id: schema.memberRoleNudges.id })
    .from(schema.memberRoleNudges)
    .where(
      and(
        eq(schema.memberRoleNudges.allianceId, input.allianceId),
        eq(schema.memberRoleNudges.ashedMemberId, input.ashedMemberId),
        eq(schema.memberRoleNudges.status, "open"),
        inArray(schema.memberRoleNudges.kind, input.kinds),
      ),
    );

  for (const row of open) {
    await db
      .update(schema.memberRoleNudges)
      .set({ status: "superseded", resolvedAt: now })
      .where(eq(schema.memberRoleNudges.id, row.id));
    await satisfyMemberRoleNudgeInboxItem(row.id);
  }
}

export async function allianceHasHqOwner(
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [alliance] = await db
    .select({ ownerHqUserId: schema.alliances.ownerHqUserId })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  if (!alliance?.ownerHqUserId) return false;

  const [membership] = await db
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, alliance.ownerHqUserId),
        eq(schema.allianceMemberships.status, "active"),
        eq(schema.allianceMemberships.roleId, ROLE_IDS.owner),
      ),
    )
    .limit(1);

  return Boolean(membership);
}

async function loadMemberName(
  allianceId: string,
  ashedMemberId: string,
): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ currentName: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row?.currentName?.trim() || ashedMemberId;
}

/**
 * After any alliance_members.allianceRank write, open/supersede R4 privilege nudges.
 */
export async function evaluateMemberRoleNudgesOnRankChange(input: {
  allianceId: string;
  ashedMemberId: string;
  previousRank: number | null;
  nextRank: number | null;
  rankEventId?: string | null;
}): Promise<{ nudgeId: string | null; kind: MemberRoleNudgeKind | null }> {
  if (input.previousRank === input.nextRank) {
    return { nudgeId: null, kind: null };
  }

  const crossedIn = crossedIntoOfficerRank(
    input.previousRank,
    input.nextRank,
  );
  const crossedOut = crossedOutOfOfficerRank(
    input.previousRank,
    input.nextRank,
  );
  if (!crossedIn && !crossedOut) {
    return { nudgeId: null, kind: null };
  }

  await supersedeOpenNudges({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    kinds: crossedIn
      ? ["deescalate"]
      : ["escalate_invite", "escalate_elevate"],
  });

  const linked = await loadLinkedMembership({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
  });

  const rejectedApplying = await loadRejectedKindsStillApplying({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    nextRank: input.nextRank,
    hqRoleName: linked.roleName,
    currentRankEventId: input.rankEventId ?? null,
  });

  const decision = decideMemberRoleNudge({
    previousRank: input.previousRank,
    nextRank: input.nextRank,
    hqRoleName: linked.roleName,
    hasActiveMembership: linked.hasActiveMembership,
    rejectedKindStillApplies: (kind) => rejectedApplying.has(kind),
  });

  if (decision.action !== "open") {
    return { nudgeId: null, kind: null };
  }

  await supersedeOpenNudges({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    kinds: [...decision.supersedeKinds, decision.kind],
  });

  const nudgeId = nanoid(16);
  const db = getDb();
  await db.insert(schema.memberRoleNudges).values({
    id: nudgeId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    hqUserId: linked.hqUserId,
    kind: decision.kind,
    fromRank: input.previousRank,
    toRank: input.nextRank,
    rankEventId: input.rankEventId ?? null,
    status: "open",
  });

  const memberName = await loadMemberName(
    input.allianceId,
    input.ashedMemberId,
  );
  const ownerOnly =
    decision.kind === "deescalate"
      ? await allianceHasHqOwner(input.allianceId)
      : false;

  await materializeMemberRoleNudgeInboxItem({
    allianceId: input.allianceId,
    nudgeId,
    kind: decision.kind,
    memberName,
    ownerOnly,
  });

  return { nudgeId, kind: decision.kind };
}
