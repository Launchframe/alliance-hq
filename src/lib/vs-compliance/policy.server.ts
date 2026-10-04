import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { VS_COMPLIANCE_READ_PERMISSION, VS_COMPLIANCE_SETTINGS_PERMISSION } from "@/lib/rbac/constants";
import { canAccessVsCompliance } from "./access.shared";
import { requireVsComplianceAccess } from "./access.server";
import { defaultVsPolicy, mergeVsPolicyPatch } from "./policy.shared";
import { VsComplianceError, type VsPolicyVersion } from "./types.shared";

function projectPolicy(row: VsPolicyVersion): VsPolicyVersion {
  return {
    version: row.version, effectiveWeek: row.effectiveWeek, enabled: row.enabled,
    dailyTarget: row.dailyTarget, weeklyMinimum: row.weeklyMinimum, leewayPct: row.leewayPct,
    preset: row.preset, removalThreshold: row.removalThreshold,
  };
}

export async function loadVsMembershipSettings(sessionId: string, allianceId: string) {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const rows = await getDb().select().from(schema.vsCompliancePolicies)
    .where(eq(schema.vsCompliancePolicies.allianceId, allianceId)).orderBy(desc(schema.vsCompliancePolicies.version));
  const history = rows.map(projectPolicy);
  return { latest: history[0] ?? null, defaults: defaultVsPolicy(), history };
}

export async function saveVsMembershipSettings(sessionId: string, allianceId: string, input: { expectedVersion: unknown; patch: unknown }, clock: () => Date = () => new Date()): Promise<VsPolicyVersion> {
  const actor = await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_SETTINGS_PERMISSION);
  if (typeof input.expectedVersion !== "number" || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 2_147_483_647) throw new VsComplianceError("invalid_policy");
  return getDb().transaction(async (tx) => {
    const [session] = await tx.select({ hqUserId: schema.sessions.hqUserId, expiresAt: schema.sessions.expiresAt }).from(schema.sessions)
      .where(eq(schema.sessions.id, actor.sessionId)).limit(1).for("share");
    if (!session || session.hqUserId !== actor.boundHqUserId || session.expiresAt <= clock()) throw new VsComplianceError("forbidden", 403);
    const [alliance] = await tx.select({ id: schema.alliances.id }).from(schema.alliances)
      .where(eq(schema.alliances.id, allianceId)).limit(1).for("update");
    if (!alliance) throw new VsComplianceError("not_found", 404);
    const users = await tx.select({ id: schema.hqUsers.id, isPlatformMaintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers)
      .where(inArray(schema.hqUsers.id, [...new Set([actor.hqUserId, actor.boundHqUserId])])).for("share");
    if (!users.some((user) => user.id === actor.hqUserId)) throw new VsComplianceError("forbidden", 403);
    const platformMaintainer = users.some((user) => user.isPlatformMaintainer === 1);
    if (!platformMaintainer) {
      const permissions = await tx.select({ roleName: schema.roles.name, permissionId: schema.rolePermissions.permissionId }).from(schema.allianceMemberships)
        .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
        .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.allianceMemberships.roleId))
        .where(and(eq(schema.allianceMemberships.allianceId, allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId), eq(schema.allianceMemberships.status, "active"), eq(schema.rolePermissions.permissionId, VS_COMPLIANCE_SETTINGS_PERMISSION))).for("share");
      if (!canAccessVsCompliance({ hqUserId: actor.hqUserId, isPlatformMaintainer: false, roleName: permissions[0]?.roleName ?? null, permissions: new Set(permissions.map((row) => row.permissionId)) }, VS_COMPLIANCE_SETTINGS_PERMISSION)) throw new VsComplianceError("forbidden", 403);
    }
    const [previous] = await tx.select().from(schema.vsCompliancePolicies).where(eq(schema.vsCompliancePolicies.allianceId, allianceId)).orderBy(desc(schema.vsCompliancePolicies.version)).limit(1);
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new VsComplianceError("changed", 409);
    const now = clock();
    if (session.expiresAt <= now) throw new VsComplianceError("forbidden", 403);
    const policy = mergeVsPolicyPatch(previous ? projectPolicy(previous) : null, input.patch, now);
    const [saved] = await tx.insert(schema.vsCompliancePolicies).values({ ...policy, id: nanoid(), allianceId, createdByHqUserId: actor.hqUserId }).returning();
    return projectPolicy(saved);
  });
}
