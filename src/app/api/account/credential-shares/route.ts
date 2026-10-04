import { NextResponse } from "next/server";

import { listCredentialSharesForHqUser } from "@/lib/ashed/credential-share.server";
import { loadSession, readSessionId, resolveEffectiveHqUserIdForSession } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session?.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hqUserId = await resolveEffectiveHqUserIdForSession(
    sessionId,
    session.hqUserId,
  );
  if (!hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shares = await listCredentialSharesForHqUser(hqUserId);
  return NextResponse.json({ shares });
}
