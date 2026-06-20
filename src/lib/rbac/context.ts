import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  loadSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";

import { ALLIANCE_ADMIN_PERMISSION } from "./constants";
import { ensureHqUserAvatarFresh } from "@/lib/profile/resolve-avatar";

export type RbacContext = {
  sessionId: string;
  hqUserId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isPlatformMaintainer: boolean;
  currentAllianceId: string | null;
  roleName: string | null;
  permissions: Set<string>;
};

async function loadUserPermissions(
  hqUserId: string,
  allianceId: string | null,
): Promise<{ roleName: string | null; permissions: Set<string> }> {
  const db = getDb();

  if (!allianceId) {
    return { roleName: null, permissions: new Set() };
  }

  const [membership] = await db
    .select({
      roleName: schema.roles.name,
      roleId: schema.allianceMemberships.roleId,
    })
    .from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, hqUserId),
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  if (!membership) {
    return { roleName: null, permissions: new Set() };
  }

  const rows = await db
    .select({ permissionId: schema.rolePermissions.permissionId })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, membership.roleId));

  return {
    roleName: membership.roleName,
    permissions: new Set(rows.map((r) => r.permissionId)),
  };
}

export async function getRbacContext(
  sessionId: string,
): Promise<RbacContext | null> {
  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return null;
  }

  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!effectiveHqUserId) {
    return null;
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, effectiveHqUserId))
    .limit(1);

  if (!user) {
    return null;
  }

  const isPlatformMaintainer = user.isPlatformMaintainer === 1;
  const { roleName, permissions } = await loadUserPermissions(
    user.id,
    session.currentAllianceId,
  );

  if (isPlatformMaintainer) {
    permissions.add("hq:admin");
  }

  const avatarUrl = await ensureHqUserAvatarFresh(
    user,
    session.currentAllianceId,
  );

  return {
    sessionId,
    hqUserId: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl,
    isPlatformMaintainer,
    currentAllianceId: session.currentAllianceId,
    roleName,
    permissions,
  };
}

/** Legacy sessions without hq_user_id keep prior allow-all behavior until reconnect. */
export async function sessionHasPermission(
  sessionId: string,
  permission: string | null,
): Promise<boolean> {
  if (!permission) {
    return false;
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return false;
  }

  if (!session.hqUserId) {
    return true;
  }

  const ctx = await getRbacContext(sessionId);
  if (!ctx) {
    return false;
  }

  if (ctx.isPlatformMaintainer) {
    return true;
  }

  return ctx.permissions.has(permission);
}

export async function sessionIsAllianceAdmin(
  sessionId: string,
): Promise<boolean> {
  return sessionHasPermission(sessionId, ALLIANCE_ADMIN_PERMISSION);
}

export async function sessionIsPlatformMaintainer(
  sessionId: string,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  return ctx?.isPlatformMaintainer ?? false;
}
