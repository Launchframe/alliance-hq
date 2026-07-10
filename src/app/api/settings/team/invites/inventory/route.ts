import { NextResponse } from "next/server";

import { listAllianceInviteInventory } from "@/lib/native-alliance/invite-inventory.server";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveTeamInviteAccess(sessionId);
  if (access instanceof NextResponse) {
    return access;
  }

  const inventory = await listAllianceInviteInventory(access.allianceId);
  return NextResponse.json({ ok: true, inventory });
}
