import "server-only";

import { NextResponse } from "next/server";

import { getRbacContext, type RbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";

/**
 * Sessions without a linked `hq_user_id` never resolve to an RBAC context
 * (see `getRbacContext`) — there is no "legacy owner" fallback here. A
 * missing/anonymous session must deny data-management access, not inherit
 * `alliance:admin` + `data:read`.
 */
export async function resolveDataManagementRbac(
  sessionId: string,
): Promise<RbacContext | null> {
  return getRbacContext(sessionId);
}

export async function resolveDataManagementApiContext(): Promise<
  | {
      sessionId: string;
      allianceId: string;
      auditHqUserId: string | null;
      rbac: RbacContext;
    }
  | NextResponse
> {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  const denied = await requireSessionPermission(session.id, "data:read");
  if (denied) {
    return denied;
  }

  const rbac = await resolveDataManagementRbac(session.id);
  if (!rbac) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return {
    sessionId: session.id,
    allianceId,
    auditHqUserId: session.hqUserId ?? rbac.hqUserId,
    rbac,
  };
}
