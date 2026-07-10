import { NextResponse } from "next/server";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { loadVrProgressChartPayload } from "@/lib/vr/load-progress-chart";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const viewerLink = session.hqUserId
    ? await getHqMemberLinkForUser(allianceId, session.hqUserId)
    : null;
  const payload = await loadVrProgressChartPayload({
    allianceId,
    viewerAshedMemberId: viewerLink?.ashedMemberId ?? null,
  });

  return NextResponse.json(payload);
}
