import { NextResponse } from "next/server";

import { vsComplianceTaskKindForStrike } from "@/lib/vs-compliance/evaluate.shared";
import { listOpenVsComplianceEvents } from "@/lib/vs-compliance/repository.server";
import { loadVsMembershipSettings } from "@/lib/vs-compliance/vs-membership-settings.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ events: [] });
  }

  const [events, settings] = await Promise.all([
    listOpenVsComplianceEvents(allianceId),
    loadVsMembershipSettings(allianceId, false),
  ]);

  return NextResponse.json({
    events: events.map((event) => ({
      ...event,
      taskKind: vsComplianceTaskKindForStrike(
        event.strikeNumber ?? 1,
        settings.missStrikesBeforeKick,
      ),
    })),
  });
}
