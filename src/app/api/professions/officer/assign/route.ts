import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import { officerAssignEng } from "@/lib/professions/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const allowed = await sessionHasPermission(session.id, "alliance:admin");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json()) as {
    engCommanderId?: string;
    wlCommanderId?: string;
  };

  if (!body.engCommanderId?.trim() || !body.wlCommanderId?.trim()) {
    return NextResponse.json(
      { error: "engCommanderId and wlCommanderId are required." },
      { status: 400 },
    );
  }

  try {
    await officerAssignEng({
      allianceId,
      engCommanderId: body.engCommanderId.trim(),
      wlCommanderId: body.wlCommanderId.trim(),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assignment failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
