import { NextResponse } from "next/server";

import {
  listAccessibleInventoryAlliances,
  listAllianceInviteInventory,
} from "@/lib/native-alliance/invite-inventory.server";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { readSessionId, loadSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveTeamInviteAccess(sessionId);
  if (access instanceof NextResponse) {
    return access;
  }

  const session = await loadSession(sessionId);
  const hqUserId = session?.hqUserId ?? access.ctx.hqUserId;

  const accessibleAlliances = await listAccessibleInventoryAlliances(hqUserId);

  const url = new URL(request.url);
  const requestedAllianceId = url.searchParams.get("allianceId");

  let allianceId = access.allianceId;
  if (requestedAllianceId && requestedAllianceId !== access.allianceId) {
    const allowed =
      access.ctx.isPlatformMaintainer ||
      accessibleAlliances.some((a) => a.id === requestedAllianceId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    allianceId = requestedAllianceId;
  }

  const inventory = await listAllianceInviteInventory(allianceId);
  return NextResponse.json({
    ok: true,
    inventory,
    alliances: accessibleAlliances,
    currentAllianceId: allianceId,
  });
}
