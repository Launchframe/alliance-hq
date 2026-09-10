import "server-only";

import { getAllianceMembershipRbac, getRbacContext, sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { loadSession } from "@/lib/session";
import { canAccessVsCompliance, type VsCompliancePermission } from "./access.shared";
import { VsComplianceError } from "./types.shared";

export type VsComplianceActor = { sessionId: string; allianceId: string; hqUserId: string; boundHqUserId: string };

export async function requireVsComplianceAccess(sessionId: string, allianceId: string, permission: VsCompliancePermission): Promise<VsComplianceActor> {
  const [context, session] = await Promise.all([getRbacContext(sessionId), loadSession(sessionId)]);
  if (!context?.hqUserId || !session?.hqUserId) throw new VsComplianceError("forbidden", 403);
  const [membership, permitted] = await Promise.all([
    getAllianceMembershipRbac(sessionId, context.hqUserId, allianceId),
    sessionHasPermissionForAlliance(sessionId, allianceId, permission),
  ]);
  const permissions = new Set(membership.permissions);
  if (context.isPlatformMaintainer && context.permissions.has("hq:admin")) permissions.add("hq:admin");
  if (!permitted || !canAccessVsCompliance({ ...context, roleName: membership.roleName, permissions }, permission)) throw new VsComplianceError("forbidden", 403);
  return { sessionId, allianceId, hqUserId: context.hqUserId, boundHqUserId: session.hqUserId };
}
