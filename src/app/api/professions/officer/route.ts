import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOfficerProfessionPortal } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "alliance:admin");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const portal = await getOfficerProfessionPortal(allianceId);
  return NextResponse.json(portal);
}
