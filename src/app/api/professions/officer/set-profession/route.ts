import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import { officerSetProfession } from "@/lib/professions/service";
import type { Profession } from "@/lib/professions/types";

export const dynamic = "force-dynamic";

const VALID: Profession[] = ["Engineer", "War Leader"];

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
    commanderId?: string;
    toProfession?: string;
  };

  if (!body.commanderId?.trim() || !body.toProfession) {
    return NextResponse.json(
      { error: "commanderId and toProfession are required." },
      { status: 400 },
    );
  }

  if (!VALID.includes(body.toProfession as Profession)) {
    return NextResponse.json({ error: "Invalid profession." }, { status: 400 });
  }

  try {
    await officerSetProfession({
      allianceId,
      commanderId: body.commanderId.trim(),
      toProfession: body.toProfession as Profession,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
