import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import {
  resolveSessionAllianceId,
  sessionHasMembershipForAlliance,
} from "@/lib/alliance/session-memberships";
import type { SystemRoleName } from "@/lib/rbac/constants";
import {
  ALLIANCE_ADMIN_PERMISSION,
  ROLE_IDS,
} from "@/lib/rbac/constants";
import {
  getRbacContext,
  type RbacContext,
} from "@/lib/rbac/context";
import { loadSession, ensureCurrentAllianceForSession } from "@/lib/session";
import { getDb, schema } from "@/lib/db";
import {
  canManageInvitesAndOnboarding,
} from "@/lib/member-link/invite-onboarding-access.server";
import {
  HYBRID_OWNER_INVITE_RANK,
  HYBRID_OFFICER_INVITE_RANK,
  hybridLeadershipInviteRoleForRank,
} from "@/lib/native-alliance/invite-rank-exceptions.shared";

const ADMIN_ASSIGNABLE_ROLES: SystemRoleName[] = [
  "officer",
  "data_entry",
  "viewer",
  "member",
];

const OFFICER_ASSIGNABLE_ROLES: SystemRoleName[] = [
  "data_entry",
  "viewer",
  "member",
];

export type TeamInviteAccess = {
  ctx: RbacContext;
  allianceId: string;
  assignableRoles: SystemRoleName[];
};

export type AssertInviteRoleOptions = {
  allianceId: string;
  targetAshedMemberId?: string | null;
};

export function assignableInviteRolesForContext(
  ctx: RbacContext,
): SystemRoleName[] {
  if (ctx.isPlatformMaintainer) {
    return ADMIN_ASSIGNABLE_ROLES;
  }

  if (
    ctx.permissions.has(ALLIANCE_ADMIN_PERMISSION) ||
    ctx.roleName === "owner" ||
    ctx.roleName === "maintainer"
  ) {
    return ADMIN_ASSIGNABLE_ROLES;
  }

  if (ctx.roleName === "officer") {
    return OFFICER_ASSIGNABLE_ROLES;
  }

  return [];
}

export function canManageTeamInvites(ctx: RbacContext): boolean {
  return assignableInviteRolesForContext(ctx).length > 0;
}

function canIssueOwnerViaR5Exception(ctx: RbacContext): boolean {
  if (ctx.isPlatformMaintainer) return true;
  if (ctx.permissions.has(ALLIANCE_ADMIN_PERMISSION)) return true;
  return (
    ctx.roleName === "owner" ||
    ctx.roleName === "maintainer" ||
    ctx.roleName === "officer"
  );
}

async function loadTargetAllianceRank(
  allianceId: string,
  targetAshedMemberId: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({
      allianceRank: schema.allianceMembers.allianceRank,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, targetAshedMemberId),
      ),
    )
    .limit(1);

  if (!row || row.status === "former") {
    return null;
  }
  return row.allianceRank ?? null;
}

/**
 * Role assignability for team invites.
 *
 * Base rules: owner/admin/maintainer may invite officer+; officers may invite
 * data_entry/viewer/member only.
 *
 * Rank exceptions (hybrid claim + UID proof):
 * - HQ officer may invite **officer** when the bound commander is in-game R4
 * - HQ officer (or owner/admin) may invite **owner** when the bound commander is R5
 * - Platform maintainers may invite **owner** without a commander target
 *
 * Other officer/owner grants still require an alliance owner (or admin path).
 */
export async function assertInviteRoleAllowed(
  ctx: RbacContext,
  roleName: SystemRoleName,
  options?: AssertInviteRoleOptions,
): Promise<void> {
  const allowed = assignableInviteRolesForContext(ctx);
  if (allowed.includes(roleName)) {
    return;
  }

  const targetId = options?.targetAshedMemberId?.trim() || null;
  const allianceId = options?.allianceId;

  if (roleName === "owner") {
    if (ctx.isPlatformMaintainer && !targetId) {
      return;
    }
    if (targetId && allianceId && canIssueOwnerViaR5Exception(ctx)) {
      const rank = await loadTargetAllianceRank(allianceId, targetId);
      if (rank === HYBRID_OWNER_INVITE_RANK) {
        return;
      }
      throw new Error(
        "Owner invites require an R5 commander claim target (or a platform maintainer).",
      );
    }
    throw new Error(
      "Owner invites require an R5 commander claim target (or a platform maintainer).",
    );
  }

  if (
    roleName === "officer" &&
    ctx.roleName === "officer" &&
    targetId &&
    allianceId
  ) {
    const rank = await loadTargetAllianceRank(allianceId, targetId);
    if (rank === HYBRID_OFFICER_INVITE_RANK) {
      return;
    }
    throw new Error(
      "Officers may only invite other officers when the commander is in-game R4. Ask the alliance owner to approve other officer invites.",
    );
  }

  throw new Error("You cannot assign that invite role.");
}

/** Profile CTA: leadership hybrid invite (R4 officer / R5 owner). */
export function viewerCanIssueLeadershipHybridInvite(
  ctx: RbacContext,
  allianceRank: number | null | undefined,
): boolean {
  if (!canManageTeamInvites(ctx)) {
    return false;
  }
  if (!hybridLeadershipInviteRoleForRank(allianceRank)) {
    return false;
  }
  if (assignableInviteRolesForContext(ctx).includes("officer")) {
    return true;
  }
  return ctx.roleName === "officer";
}

export async function resolveTeamInviteAccess(
  sessionId: string,
): Promise<TeamInviteAccess | NextResponse> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedSession = await ensureCurrentAllianceForSession(session);

  const allianceId = resolveSessionAllianceId(resolvedSession);
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canManageTeamInvites(ctx)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getDb();
  const [alliance] = await db
    .select({
      ownerHqUserId: schema.alliances.ownerHqUserId,
      inviteOnboardingMinRole: schema.alliances.inviteOnboardingMinRole,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  if (
    alliance &&
    !canManageInvitesAndOnboarding(ctx, alliance)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (
    !ctx.isPlatformMaintainer &&
    !(await sessionHasMembershipForAlliance(ctx.hqUserId, allianceId))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return {
    ctx,
    allianceId,
    assignableRoles: assignableInviteRolesForContext(ctx),
  };
}

export function isSystemRoleName(value: string): value is SystemRoleName {
  return value in ROLE_IDS;
}
