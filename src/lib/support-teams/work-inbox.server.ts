import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { canViewTeamWork } from "./work-routing.shared";

export async function canReadTeamWorkInbox(input: { allianceId: string; hqUserId: string; permissions: Set<string>; personal?: boolean }) {
  const db = getDb();
  const memberships = await db.select({ role: schema.roles.name, roleId: schema.roles.id }).from(schema.allianceMemberships).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, input.allianceId), eq(schema.allianceMemberships.hqUserId, input.hqUserId), eq(schema.allianceMemberships.status, "active")));
  if (!memberships.length) return false;
  const grants = await db.select({ permission: schema.rolePermissions.permissionId }).from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, memberships[0].roleId));
  const permissions = grants.map((grant) => grant.permission).filter((permission) => input.permissions.has(permission));
  const items = await db.select({ allianceId: schema.teamWorkItems.allianceId, assigneeId: schema.teamWorkItems.assigneeId, requiredPermission: schema.teamWorkItems.requiredPermission }).from(schema.teamWorkItems)
    .where(and(eq(schema.teamWorkItems.allianceId, input.allianceId), eq(schema.teamWorkItems.open, true)));
  return items.some((item) => canViewTeamWork(item, { id: input.hqUserId, allianceId: input.allianceId, role: memberships[0].role, permissions, active: true, memberIds: [], name: null }, input.personal ?? false));
}
