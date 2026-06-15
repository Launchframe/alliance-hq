import { NextResponse } from "next/server";

import { loadViralResistanceLeaderboard } from "@/lib/vr/load-leaderboard";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const payload = await loadViralResistanceLeaderboard(allianceId);
  return NextResponse.json(payload);
}
