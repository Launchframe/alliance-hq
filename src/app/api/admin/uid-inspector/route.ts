import { NextResponse } from "next/server";

import { parseAdminUidInspectorQueryParams } from "@/lib/admin/admin-uid-inspector-query.shared";
import {
  listAdminUidInspectorAlliances,
  resolveAdminUidInspectorRequest,
} from "@/lib/admin/admin-uid-inspector.server";
import { getRbacContext, requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const params = parseAdminUidInspectorQueryParams(new URL(request.url).searchParams);

  if (!params.gameUid) {
    const alliances = await listAdminUidInspectorAlliances();
    return NextResponse.json({ alliances });
  }

  const rbac = await getRbacContext(sessionId);
  if (!rbac?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = await resolveAdminUidInspectorRequest({
    params,
    sessionId,
    hqUserId: rbac.hqUserId,
  });

  if (!response.ok) {
    const status = response.error === "invalid_uid" ? 400 : 400;
    return NextResponse.json(
      { error: response.error },
      { status },
    );
  }

  return NextResponse.json(response.result);
}
