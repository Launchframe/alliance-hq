import "server-only";

import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { resolveCommanderForHqUser } from "./service";

export type ProfessionRequestContext = {
  sessionId: string;
  hqUserId: string;
  allianceId: string;
  commanderId: string;
  profession: string | null;
};

export async function resolveProfessionRequestContext(): Promise<
  ProfessionRequestContext | NextResponse
> {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }
  if (!session.hqUserId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const resolved = await resolveCommanderForHqUser(session.hqUserId, allianceId);
  if (!resolved) {
    return NextResponse.json(
      { error: "No linked commander found for this alliance." },
      { status: 400 },
    );
  }

  return {
    sessionId: session.id,
    hqUserId: session.hqUserId,
    allianceId,
    commanderId: resolved.commanderId,
    profession: resolved.profession,
  };
}
