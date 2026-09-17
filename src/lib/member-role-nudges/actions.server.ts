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

async function resolveNudge(input: {
  nudgeId: string;
  status: "accepted" | "rejected";
  actorHqUserId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.memberRoleNudges)
    .set({
      status: input.status,
      resolvedByHqUserId: input.actorHqUserId,
      resolvedAt: new Date(),
    })
    .where(eq(schema.memberRoleNudges.id, input.nudgeId));
  await satisfyMemberRoleNudgeInboxItem(input.nudgeId);
}

export async function rejectMemberRoleNudge(input: {
  allianceId: string;
  nudgeId: string;
  ctx: RbacContext;
}): Promise<{ ok: true }> {
  const nudge = await loadOpenNudge(input.allianceId, input.nudgeId);
  await assertCanActOnNudge(input.ctx, nudge.kind, input.allianceId);
  await resolveNudge({
    nudgeId: nudge.id,
    status: "rejected",
    actorHqUserId: input.ctx.hqUserId,
  });
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
  const db = getDb();

  if (nudge.kind === "escalate_elevate") {
    if (!nudge.hqUserId) {
      throw new MemberRoleNudgeError(
        "No linked HQ user to elevate.",
        "INVALID",
      );
    }

    const [existing] = await db
      .select({
        id: schema.allianceMemberships.id,
        roleId: schema.allianceMemberships.roleId,
      })
      .from(schema.allianceMemberships)
      .where(
        and(
          eq(schema.allianceMemberships.allianceId, input.allianceId),
          eq(schema.allianceMemberships.hqUserId, nudge.hqUserId),
          eq(schema.allianceMemberships.status, "active"),
        ),
      )
      .limit(1);

    const fromRoleId = existing?.roleId ?? null;
    const membershipId = await assignManualMembership({
      hqUserId: nudge.hqUserId,
      allianceId: input.allianceId,
      roleId: ROLE_IDS.officer,
    });

    await appendAllianceMembershipRoleEvent({
      allianceId: input.allianceId,
      hqUserId: nudge.hqUserId,
      fromRoleId,
      toRoleId: ROLE_IDS.officer,
      source: "nudge_accept",
      actorHqUserId: input.ctx.hqUserId,
      nudgeId: nudge.id,
    });

    await resolveNudge({
      nudgeId: nudge.id,
      status: "accepted",
      actorHqUserId: input.ctx.hqUserId,
    });

    return {
      ok: true,
      kind: "escalate_elevate",
      hqUserId: nudge.hqUserId,
      membershipId,
    };
  }

  if (nudge.kind === "escalate_invite") {
    const invite = await createHqInvite({
      allianceId: input.allianceId,
      kind: "protected_link",
      roleName: "officer" as SystemRoleName,
      invitedByHqUserId: input.ctx.hqUserId,
      origin: input.origin,
      targetAshedMemberId: nudge.ashedMemberId,
      adminLabel: `R4 privilege nudge ${nudge.id.slice(0, 8)}`,
    });

    await resolveNudge({
      nudgeId: nudge.id,
      status: "accepted",
      actorHqUserId: input.ctx.hqUserId,
    });

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

  if (!nudge.hqUserId) {
    throw new MemberRoleNudgeError(
      "No linked HQ officer to demote.",
      "INVALID",
    );
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
        eq(schema.allianceMemberships.hqUserId, nudge.hqUserId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!membership || membership.roleId !== ROLE_IDS.officer) {
    throw new MemberRoleNudgeError(
      "Target is not an active HQ officer.",
      "INVALID",
    );
  }

  try {
    const result = await revokeOfficerMembershipToMember({
      allianceId: input.allianceId,
      membershipId: membership.id,
      actorHqUserId: input.ctx.hqUserId,
      roleEventSource: "nudge_accept",
      nudgeId: nudge.id,
    });
    await resolveNudge({
      nudgeId: nudge.id,
      status: "accepted",
      actorHqUserId: input.ctx.hqUserId,
    });
    return {
      ok: true,
      kind: "deescalate",
      hqUserId: result.hqUserId,
      membershipId: result.membershipId,
    };
  } catch (error) {
    if (error instanceof TeamOfficerRevokeError) {
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

export async function listOpenMemberRoleNudges(allianceId: string) {
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

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as MemberRoleNudgeKind,
    status: row.status,
    fromRank: row.fromRank,
    toRank: row.toRank,
    ashedMemberId: row.ashedMemberId,
    hqUserId: row.hqUserId,
    memberName: row.memberName ?? row.ashedMemberId,
    createdAt: row.createdAt.toISOString(),
  }));
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
