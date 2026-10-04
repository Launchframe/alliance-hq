import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@/lib/db";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { lockCompliance } from "@/lib/vs-compliance/evidence.server";
import { loadBoard, lockBoard, type SupportTransaction } from "./repository.server";
import { loadSupportRoster, loadSupportStints } from "./roster.server";
import { projectMemberships } from "./maintenance.server";
import type { WorkRecipient } from "./work-routing.shared";

export async function loadWorkContext(tx: SupportTransaction, allianceId: string) {
  await lockAllianceAvailability(tx, allianceId);
  await lockBoard(tx, allianceId);
  const memberships = await tx.select({ id: schema.hqUsers.id, name: schema.hqUsers.displayName, role: schema.roles.name, roleId: schema.roles.id })
    .from(schema.allianceMemberships).innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, allianceId), eq(schema.allianceMemberships.status, "active"))).for("share");
  const permissions = await tx.select().from(schema.rolePermissions).for("share");
  await lockCompliance(tx, allianceId);
  const roster = await loadSupportRoster(allianceId, tx);
  const stints = await loadSupportStints(allianceId, tx);
  const board = projectMemberships(await loadBoard(tx, allianceId), roster, stints);
  const legacy = await tx.select({ userId: schema.hqMemberLinks.hqUserId, memberId: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(eq(schema.hqMemberLinks.allianceId, allianceId));
  const canonical = await tx.select({ userId: schema.hqUserCommanders.hqUserId, memberId: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders)
    .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
    .where(and(eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
  const recipients: WorkRecipient[] = memberships.map((membership) => ({ ...membership, allianceId, active: true,
    permissions: permissions.filter((permission) => permission.roleId === membership.roleId).map((permission) => permission.permissionId),
    memberIds: [...new Set([...legacy, ...canonical].filter((link) => link.userId === membership.id && roster.some((member) => member.id === link.memberId) && stints[link.memberId]).map((link) => link.memberId))],
  }));
  return { roster, stints, board, recipients };
}
