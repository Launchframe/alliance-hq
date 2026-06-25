import { NextResponse } from "next/server";

import { listPendingRosterLinkRequests } from "@/lib/member-link/roster-link-resolve.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const requests = await listPendingRosterLinkRequests(allianceId);
  return NextResponse.json({ requests });
}
