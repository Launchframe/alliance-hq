import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { saveHqMemberLinkPending } from "@/lib/member-link/repository.server";
import {
  clearSessionAllianceContext,
  loadSession,
  readSessionId,
} from "@/lib/session";

export async function POST() {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "No browser session" }, { status: 400 });
  }

  const session = await loadSession(sessionId);
  if (
    session?.hqUserId &&
    session.hqUserId !== authSession.user.id
  ) {
    return NextResponse.json(
      {
        code: "session_mismatch",
        error: "Browser session belongs to another account.",
      },
      { status: 403 },
    );
  }

  const allianceId =
    session?.currentAllianceId ?? session?.allianceId ?? null;

  if (allianceId) {
    await saveHqMemberLinkPending(allianceId, authSession.user.id, null);
  }

  await clearSessionAllianceContext(sessionId);

  return NextResponse.json({ ok: true });
}
