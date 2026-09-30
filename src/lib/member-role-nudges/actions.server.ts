import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import {
  ALLIANCE_ADMIN_PERMISSION,
  ROLE_IDS,
  type SystemRoleName,
} from "@/lib/rbac/constants";
import type { RbacContext } from "@/lib/rbac/context";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";
import { createHqInvite } from "@/lib/native-alliance/invites";
import { allianceHasHqOwner } from "@/lib/member-role-nudges/evaluate-rank-change.server";
import { satisfyMemberRoleNudgeInboxItem } from "@/lib/member-role-nudges/inbox.server";
import { appendAllianceMembershipRoleEvent } from "@/lib/member-role-nudges/role-events.server";
import {
  isMemberRoleNudgeKind,
  type MemberRoleNudgeKind,
} from "@/lib/member-role-nudges/types.shared";
import { canRevokeOfficerAccess } from "@/lib/settings/team-officer-revoke.shared";
import {
  TeamOfficerRevokeError,
  revokeOfficerMembershipToMember,
} from "@/lib/settings/team-officer-revoke.server";

export class MemberRoleNudgeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID"
      | "CONFLICT"
      | "LAST_OFFICER",
  ) {
    super(message);
    this.name = "MemberRoleNudgeError";
  }
}

function isEscalateAudience(ctx: RbacContext): boolean {
  if (ctx.isPlatformMaintainer) return true;
  if (ctx.permissions.has(ALLIANCE_ADMIN_PERMISSION)) return true;
  return (
    ctx.roleName === "owner" ||
    ctx.roleName === "maintainer" ||
    ctx.roleName === "officer"
  );
}

async function assertCanActOnNudge(
  ctx: RbacContext,
  kind: MemberRoleNudgeKind,
  allianceId: string,
): Promise<void> {
  if (kind === "escalate_invite" || kind === "escalate_elevate") {
    if (!isEscalateAudience(ctx)) {
      throw new MemberRoleNudgeError("Forbidden.", "FORBIDDEN");
    }
    return;
  }

  const ownerPresent = await allianceHasHqOwner(allianceId);
  if (ownerPresent) {
    if (!canRevokeOfficerAccess(ctx)) {
      throw new MemberRoleNudgeError(
        "Only the alliance owner can act on this demotion nudge.",
        "FORBIDDEN",
      );
    }
    return;
  }

  if (!isEscalateAudience(ctx)) {
    throw new MemberRoleNudgeError("Forbidden.", "FORBIDDEN");
  }
}

async function loadOpenNudge(allianceId: string, nudgeId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.memberRoleNudges)
    .where(
      and(
        eq(schema.memberRoleNudges.id, nudgeId),
        eq(schema.memberRoleNudges.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new MemberRoleNudgeError("Nudge not found.", "NOT_FOUND");
  }
  if (row.status !== "open") {
    throw new MemberRoleNudgeError("Nudge is no longer open.", "CONFLICT");
  }
  if (!isMemberRoleNudgeKind(row.kind)) {
    throw new MemberRoleNudgeError("Invalid nudge kind.", "INVALID");
  }
  return { ...row, kind: row.kind as MemberRoleNudgeKind };
}

async function claimOpenNudge(input: {
  nudgeId: string;
  allianceId: string;
  status: "accepted" | "rejected";
  actorHqUserId: string;
}): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(schema.memberRoleNudges)
    .set({
      status: input.status,
      resolvedByHqUserId: input.actorHqUserId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memberRoleNudges.id, input.nudgeId),
        eq(schema.memberRoleNudges.allianceId, input.allianceId),
        eq(schema.memberRoleNudges.status, "open"),
      ),
    )
    .returning({ id: schema.memberRoleNudges.id });

  if (!row) {
    throw new MemberRoleNudgeError("Nudge is no longer open.", "CONFLICT");
  }
}

async function supersedeClaimedNudge(nudgeId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.memberRoleNudges)
    .set({ status: "superseded", resolvedByHqUserId: null })
    .where(
      and(
        eq(schema.memberRoleNudges.id, nudgeId),
        eq(schema.memberRoleNudges.status, "accepted"),
      ),
    );
  await satisfyMemberRoleNudgeInboxItem(nudgeId);
}

async function reopenClaimedNudge(nudgeId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.memberRoleNudges)
    .set({ status: "open", resolvedByHqUserId: null, resolvedAt: null })
    .where(
      and(
        eq(schema.memberRoleNudges.id, nudgeId),
        eq(schema.memberRoleNudges.status, "accepted"),
      ),
    );
}

async function loadCurrentNudgeState(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<{
  currentRank: number | null;
  linkedHqUserId: string | null;
  membershipId: string | null;
  membershipRoleId: string | null;
  membershipRoleName: string | null;
}> {
  const db = getDb();
  const [member] = await db
    .select({ allianceRank: schema.allianceMembers.allianceRank })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  const [link] = await db
    .select({ hqUserId: schema.hqMemberLinks.hqUserId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, input.allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!link) {
    return {
      currentRank: member?.allianceRank ?? null,
      linkedHqUserId: null,
      membershipId: null,
      membershipRoleId: null,
      membershipRoleName: null,
    };
  }

  const [membership] = await db
    .select({
      id: schema.allianceMemberships.id,
      roleId: schema.allianceMemberships.roleId,
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

  return {
    currentRank: member?.allianceRank ?? null,
    linkedHqUserId: link.hqUserId,
    membershipId: membership?.id ?? null,
    membershipRoleId: membership?.roleId ?? null,
    membershipRoleName: membership
      ? systemRoleNameForId(membership.roleId)
      : null,
  };
}

function validateNudgeCurrentState(input: {
  kind: MemberRoleNudgeKind;
  currentRank: number | null;
  linkedHqUserId: string | null;
  membershipId: string | null;
  membershipRoleName: string | null;
}): string | null {
  const roleName = input.membershipRoleName;

  if (input.kind === "escalate_invite") {
    if (input.currentRank !== 4) {
      return "Target is no longer R4.";
    }
    if (input.membershipId) {
      return "Target already has an active HQ membership.";
    }
    return null;
  }

  if (input.kind === "escalate_elevate") {
    if (input.currentRank !== 4) {
      return "Target is no longer R4.";
    }
    if (!input.linkedHqUserId || !input.membershipId) {
      return "Target has no active HQ membership to elevate.";
    }
    if (
      roleName !== "member" &&
      roleName !== "viewer" &&
      roleName !== "data_entry"
    ) {
      return "Target role cannot be overwritten by elevation.";
    }
    return null;
  }

  if (
    input.currentRank != null &&
    (input.currentRank < 1 || input.currentRank > 3)
  ) {
    return "Target is still R4 or higher.";
  }
  if (!input.linkedHqUserId || roleName !== "officer") {
    return "Target is not an active HQ officer.";
  }
  return null;
}

export async function rejectMemberRoleNudge(input: {
  allianceId: string;
  nudgeId: string;
  ctx: RbacContext;
}): Promise<{ ok: true }> {
  const nudge = await loadOpenNudge(input.allianceId, input.nudgeId);
  await assertCanActOnNudge(input.ctx, nudge.kind, input.allianceId);
  await claimOpenNudge({
    nudgeId: nudge.id,
    allianceId: input.allianceId,
    status: "rejected",
    actorHqUserId: input.ctx.hqUserId,
  });
  await satisfyMemberRoleNudgeInboxItem(nudge.id);
  return { ok: true };
}

export type AcceptMemberRoleNudgeResult =
  | {
      ok: true;
      kind: "escalate_elevate";
      hqUserId: string;
      membershipId: string;
    }
  | {
      ok: true;
      kind: "escalate_invite";
      inviteId: string;
      inviteUrl: string;
      passphrase?: string;
      targetAshedMemberId: string;
      targetCommanderName: string | null;
    }
  | {
      ok: true;
      kind: "deescalate";
      hqUserId: string;
      membershipId: string;
    };

export async function acceptMemberRoleNudge(input: {
  allianceId: string;
  nudgeId: string;
  ctx: RbacContext;
  origin: string;
}): Promise<AcceptMemberRoleNudgeResult> {
  const nudge = await loadOpenNudge(input.allianceId, input.nudgeId);
  await assertCanActOnNudge(input.ctx, nudge.kind, input.allianceId);

  await claimOpenNudge({
    nudgeId: nudge.id,
    allianceId: input.allianceId,
    status: "accepted",
    actorHqUserId: input.ctx.hqUserId,
  });

  let current;
  try {
    current = await loadCurrentNudgeState({
      allianceId: input.allianceId,
      ashedMemberId: nudge.ashedMemberId,
    });
  } catch (error) {
    await reopenClaimedNudge(nudge.id);
    throw error;
  }
  const staleReason = validateNudgeCurrentState({
    kind: nudge.kind,
    currentRank: current.currentRank,
    linkedHqUserId: current.linkedHqUserId,
    membershipId: current.membershipId,
    membershipRoleName: current.membershipRoleName,
  });
  if (staleReason) {
    await supersedeClaimedNudge(nudge.id);
    throw new MemberRoleNudgeError(staleReason, "CONFLICT");
  }

  if (nudge.kind === "escalate_elevate") {
    const targetHqUserId = current.linkedHqUserId;
    const fromRoleId = current.membershipRoleId;
    if (!targetHqUserId || !current.membershipId) {
      await supersedeClaimedNudge(nudge.id);
      throw new MemberRoleNudgeError(
        "Target has no active HQ membership to elevate.",
        "CONFLICT",
      );
    }

    const membershipId = await assignManualMembership({
      hqUserId: targetHqUserId,
      allianceId: input.allianceId,
      roleId: ROLE_IDS.officer,
    });

    await appendAllianceMembershipRoleEvent({
      allianceId: input.allianceId,
      hqUserId: targetHqUserId,
      fromRoleId,
      toRoleId: ROLE_IDS.officer,
      source: "nudge_accept",
      actorHqUserId: input.ctx.hqUserId,
      nudgeId: nudge.id,
    });

    await satisfyMemberRoleNudgeInboxItem(nudge.id);

    return {
      ok: true,
      kind: "escalate_elevate",
      hqUserId: targetHqUserId,
      membershipId,
    };
  }

  if (nudge.kind === "escalate_invite") {
    let invite;
    try {
      invite = await createHqInvite({
        allianceId: input.allianceId,
        kind: "protected_link",
        roleName: "officer" as SystemRoleName,
        invitedByHqUserId: input.ctx.hqUserId,
        origin: input.origin,
        targetAshedMemberId: nudge.ashedMemberId,
        adminLabel: `R4 privilege nudge ${nudge.id.slice(0, 8)}`,
      });
    } catch (error) {
      await reopenClaimedNudge(nudge.id);
      throw error;
    }

    await satisfyMemberRoleNudgeInboxItem(nudge.id);

    return {
      ok: true,
      kind: "escalate_invite",
      inviteId: invite.inviteId,
      inviteUrl: invite.inviteUrl,
      passphrase: invite.passphrase ?? undefined,
      targetAshedMemberId: nudge.ashedMemberId,
      targetCommanderName: invite.targetCommanderName ?? null,
    };
  }

  const membershipId = current.membershipId;
  if (!membershipId) {
    await supersedeClaimedNudge(nudge.id);
    throw new MemberRoleNudgeError(
      "Target is not an active HQ officer.",
      "CONFLICT",
    );
  }

  try {
    const result = await revokeOfficerMembershipToMember({
      allianceId: input.allianceId,
      membershipId,
      actorHqUserId: input.ctx.hqUserId,
      roleEventSource: "nudge_accept",
      nudgeId: nudge.id,
    });
    await satisfyMemberRoleNudgeInboxItem(nudge.id);
    return {
      ok: true,
      kind: "deescalate",
      hqUserId: result.hqUserId,
      membershipId: result.membershipId,
    };
  } catch (error) {
    if (error instanceof TeamOfficerRevokeError) {
      await supersedeClaimedNudge(nudge.id);
      throw new MemberRoleNudgeError(
        error.message,
        error.code === "LAST_OFFICER" ? "LAST_OFFICER" : "INVALID",
      );
    }
    throw error;
  }
}

/** Elevate an existing membership to officer (owner/admin path, not nudge). */
export async function elevateMembershipToOfficer(input: {
  allianceId: string;
  membershipId: string;
  actorHqUserId: string;
}): Promise<{ membershipId: string; hqUserId: string }> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.allianceMemberships)
    .where(eq(schema.allianceMemberships.id, input.membershipId))
    .limit(1);

  if (
    !existing ||
    existing.allianceId !== input.allianceId ||
    existing.status !== "active"
  ) {
    throw new MemberRoleNudgeError("Membership not found.", "NOT_FOUND");
  }

  const fromRoleId = existing.roleId;
  const fromName = systemRoleNameForId(fromRoleId);
  if (
    fromName === "owner" ||
    fromName === "maintainer" ||
    fromName === "officer"
  ) {
    throw new MemberRoleNudgeError(
      "Membership is already officer or higher.",
      "INVALID",
    );
  }

  await assignManualMembership({
    hqUserId: existing.hqUserId,
    allianceId: input.allianceId,
    roleId: ROLE_IDS.officer,
  });

  await appendAllianceMembershipRoleEvent({
    allianceId: input.allianceId,
    hqUserId: existing.hqUserId,
    fromRoleId,
    toRoleId: ROLE_IDS.officer,
    source: "team_elevate",
    actorHqUserId: input.actorHqUserId,
  });

  return { membershipId: existing.id, hqUserId: existing.hqUserId };
}

function canActOnNudgeKind(
  ctx: RbacContext,
  kind: MemberRoleNudgeKind,
  ownerPresent: boolean,
): boolean {
  if (kind === "escalate_invite" || kind === "escalate_elevate") {
    return isEscalateAudience(ctx);
  }
  if (ownerPresent) {
    return canRevokeOfficerAccess(ctx);
  }
  return isEscalateAudience(ctx);
}

export async function listOpenMemberRoleNudges(
  allianceId: string,
  ctx: RbacContext,
) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.memberRoleNudges.id,
      kind: schema.memberRoleNudges.kind,
      status: schema.memberRoleNudges.status,
      fromRank: schema.memberRoleNudges.fromRank,
      toRank: schema.memberRoleNudges.toRank,
      ashedMemberId: schema.memberRoleNudges.ashedMemberId,
      hqUserId: schema.memberRoleNudges.hqUserId,
      createdAt: schema.memberRoleNudges.createdAt,
      memberName: schema.allianceMembers.currentName,
    })
    .from(schema.memberRoleNudges)
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(
          schema.allianceMembers.allianceId,
          schema.memberRoleNudges.allianceId,
        ),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.memberRoleNudges.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.memberRoleNudges.allianceId, allianceId),
        eq(schema.memberRoleNudges.status, "open"),
      ),
    )
    .orderBy(desc(schema.memberRoleNudges.createdAt));

  const ownerPresent = rows.some((row) => row.kind === "deescalate")
    ? await allianceHasHqOwner(allianceId)
    : false;

  const result = [] as Array<{
    id: string;
    kind: MemberRoleNudgeKind;
    status: string;
    fromRank: number | null;
    toRank: number | null;
    ashedMemberId: string;
    hqUserId: string | null;
    memberName: string;
    canAct: boolean;
    createdAt: string;
  }>;
  for (const row of rows) {
    const kind = row.kind as MemberRoleNudgeKind;
    result.push({
      id: row.id,
      kind,
      status: row.status,
      fromRank: row.fromRank,
      toRank: row.toRank,
      ashedMemberId: row.ashedMemberId,
      hqUserId: row.hqUserId,
      memberName: row.memberName ?? row.ashedMemberId,
      canAct: canActOnNudgeKind(ctx, kind, ownerPresent),
      createdAt: row.createdAt.toISOString(),
    });
  }
  return result;
}

export async function listTeamRoleHistory(allianceId: string, limit = 50) {
  const db = getDb();
  const [nudges, roleEvents, rankEvents] = await Promise.all([
    db
      .select({
        id: schema.memberRoleNudges.id,
        kind: schema.memberRoleNudges.kind,
        status: schema.memberRoleNudges.status,
        fromRank: schema.memberRoleNudges.fromRank,
        toRank: schema.memberRoleNudges.toRank,
        ashedMemberId: schema.memberRoleNudges.ashedMemberId,
        createdAt: schema.memberRoleNudges.createdAt,
        resolvedAt: schema.memberRoleNudges.resolvedAt,
        memberName: schema.allianceMembers.currentName,
      })
      .from(schema.memberRoleNudges)
      .leftJoin(
        schema.allianceMembers,
        and(
          eq(
            schema.allianceMembers.allianceId,
            schema.memberRoleNudges.allianceId,
          ),
          eq(
            schema.allianceMembers.ashedMemberId,
            schema.memberRoleNudges.ashedMemberId,
          ),
        ),
      )
      .where(eq(schema.memberRoleNudges.allianceId, allianceId))
      .orderBy(desc(schema.memberRoleNudges.createdAt))
      .limit(limit),
    db
      .select({
        id: schema.allianceMembershipRoleEvents.id,
        hqUserId: schema.allianceMembershipRoleEvents.hqUserId,
        fromRoleId: schema.allianceMembershipRoleEvents.fromRoleId,
        toRoleId: schema.allianceMembershipRoleEvents.toRoleId,
        source: schema.allianceMembershipRoleEvents.source,
        createdAt: schema.allianceMembershipRoleEvents.createdAt,
        email: schema.hqUsers.email,
        displayName: schema.hqUsers.displayName,
      })
      .from(schema.allianceMembershipRoleEvents)
      .innerJoin(
        schema.hqUsers,
        eq(schema.hqUsers.id, schema.allianceMembershipRoleEvents.hqUserId),
      )
      .where(eq(schema.allianceMembershipRoleEvents.allianceId, allianceId))
      .orderBy(desc(schema.allianceMembershipRoleEvents.createdAt))
      .limit(limit),
    db
      .select({
        id: schema.memberAllianceRankEvents.id,
        ashedMemberId: schema.memberAllianceRankEvents.ashedMemberId,
        memberName: schema.memberAllianceRankEvents.memberName,
        allianceRank: schema.memberAllianceRankEvents.allianceRank,
        source: schema.memberAllianceRankEvents.source,
        recordedAt: schema.memberAllianceRankEvents.recordedAt,
      })
      .from(schema.memberAllianceRankEvents)
      .where(eq(schema.memberAllianceRankEvents.allianceId, allianceId))
      .orderBy(desc(schema.memberAllianceRankEvents.recordedAt))
      .limit(limit),
  ]);

  type TimelineItem = {
    id: string;
    type: "nudge" | "role_change" | "rank_change";
    at: string;
    summary: Record<string, unknown>;
  };

  const items: TimelineItem[] = [
    ...nudges.map((row) => ({
      id: `nudge:${row.id}`,
      type: "nudge" as const,
      at: (row.resolvedAt ?? row.createdAt).toISOString(),
      summary: {
        nudgeId: row.id,
        kind: row.kind,
        status: row.status,
        fromRank: row.fromRank,
        toRank: row.toRank,
        memberName: row.memberName ?? row.ashedMemberId,
        createdAt: row.createdAt.toISOString(),
      },
    })),
    ...roleEvents.map((row) => ({
      id: `role:${row.id}`,
      type: "role_change" as const,
      at: row.createdAt.toISOString(),
      summary: {
        hqUserId: row.hqUserId,
        email: row.email,
        displayName: row.displayName,
        fromRole: row.fromRoleId
          ? systemRoleNameForId(row.fromRoleId)
          : null,
        toRole: systemRoleNameForId(row.toRoleId),
        source: row.source,
      },
    })),
    ...rankEvents.map((row) => ({
      id: `rank:${row.id}`,
      type: "rank_change" as const,
      at: row.recordedAt.toISOString(),
      summary: {
        ashedMemberId: row.ashedMemberId,
        memberName: row.memberName,
        allianceRank: row.allianceRank,
        source: row.source,
      },
    })),
  ];

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items.slice(0, limit);
}
