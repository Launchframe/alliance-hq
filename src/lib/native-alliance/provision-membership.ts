import "server-only";

import { eq } from "drizzle-orm";

import { grantHqAccess } from "@/lib/access/invite-gate";
import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import type { SystemRoleName } from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

export type ProvisionAllianceMembershipInput = {
  hqUserId: string;
  sessionId: string;
  allianceId: string;
  roleId: string;
  userLabel?: string | null;
  ownerEmail?: string | null;
};

export type ProvisionAllianceMembershipResult = {
  allianceId: string;
  allianceTag: string;
  allianceName: string;
  hqUserId: string;
  roleName: SystemRoleName | null;
};

export async function provisionAllianceMembership(
  input: ProvisionAllianceMembershipInput,
): Promise<ProvisionAllianceMembershipResult> {
  const db = getDb();
  const [alliance] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!alliance?.tag?.trim()) {
    throw new Error("Alliance tag is missing.");
  }

  await grantHqAccess(input.hqUserId);
  await assignManualMembership({
    hqUserId: input.hqUserId,
    allianceId: input.allianceId,
    roleId: input.roleId,
  });

  const now = new Date();
  const roleName = systemRoleNameForId(input.roleId);
  if (roleName === "owner") {
    await db
      .update(schema.alliances)
      .set({
        ownerHqUserId: input.hqUserId,
        ownerEmail: input.ownerEmail ?? null,
        updatedAt: now,
      })
      .where(eq(schema.alliances.id, input.allianceId));
  }

  const tag = alliance.tag.trim();
  const userLabel =
    input.userLabel?.trim() ||
    input.ownerEmail?.trim() ||
    (await loadUserEmail(input.hqUserId));

  await db
    .update(schema.sessions)
    .set({
      hqUserId: input.hqUserId,
      currentAllianceId: input.allianceId,
      allianceTag: tag,
      allianceId: input.allianceId,
      userLabel: userLabel ?? null,
      updatedAt: now,
    })
    .where(eq(schema.sessions.id, input.sessionId));

  return {
    allianceId: input.allianceId,
    allianceTag: tag,
    allianceName: alliance.name,
    hqUserId: input.hqUserId,
    roleName,
  };
}

async function loadUserEmail(hqUserId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row?.email ?? null;
}
