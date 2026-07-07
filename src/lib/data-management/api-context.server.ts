import "server-only";

import { NextResponse } from "next/server";

import { canViewDataManagement } from "@/lib/data-management/batch-authorization.shared";
import { getRbacContext } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";

export async function resolveDataManagementApiContext(): Promise<
  | {
      sessionId: string;
      allianceId: string;
      rbac: NonNullable<Awaited<ReturnType<typeof getRbacContext>>>;
    }
  | NextResponse
> {
  const session = await getOrCreateSession();
  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return NextResponse.json({ error: "Alliance context required." }, { status: 400 });
  }

  const rbac = await getRbacContext(session.id);
  if (!rbac) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canViewDataManagement(rbac.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return {
    sessionId: session.id,
    allianceId,
    rbac,
  };
}
