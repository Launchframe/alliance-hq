import "server-only";

import { NextResponse } from "next/server";

import { getRbacContext, type RbacContext } from "@/lib/rbac/context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession, loadSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";

/** Legacy sessions (no hq_user_id) keep allow-all behavior until reconnect. */
export function legacyAllowAllDataManagementRbac(
  sessionId: string,
  allianceId: string,
): RbacContext {
  return {
    sessionId,
    hqUserId: "",
    email: "",
    displayName: null,
    avatarUrl: null,
    isPlatformMaintainer: false,
    currentAllianceId: allianceId,
    roleName: "owner",
    permissions: new Set(["alliance:admin", "data:read"]),
  };
}

export async function resolveDataManagementRbac(
  sessionId: string,
  allianceId: string,
): Promise<RbacContext | null> {
  const rbac = await getRbacContext(sessionId);
  if (rbac) {
    return rbac;
  }

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return legacyAllowAllDataManagementRbac(sessionId, allianceId);
  }

  return null;
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
  const session = await getOrCreateSession();
  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  const denied = await requireSessionPermission(session.id, "data:read");
  if (denied) {
    return denied;
  }

  const rbac = await resolveDataManagementRbac(session.id, allianceId);
  if (!rbac) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return {
    sessionId: session.id,
    allianceId,
    auditHqUserId: session.hqUserId ?? (rbac.hqUserId || null),
    rbac,
  };
}
