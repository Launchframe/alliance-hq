import "server-only";

import { NextResponse } from "next/server";

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
import { eq } from "drizzle-orm";
import {
  canManageInvitesAndOnboarding,
} from "@/lib/member-link/invite-onboarding-access.server";

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

export function assertInviteRoleAllowed(
  ctx: RbacContext,
  roleName: SystemRoleName,
): void {
  if (roleName === "owner") {
    throw new Error("Owner invites require a platform maintainer.");
  }

  const allowed = assignableInviteRolesForContext(ctx);
  if (!allowed.includes(roleName)) {
    throw new Error("You cannot assign that invite role.");
  }
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
