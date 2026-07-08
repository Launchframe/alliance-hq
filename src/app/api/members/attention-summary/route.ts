import { NextResponse } from "next/server";

import { loadMembersAttentionSummary } from "@/lib/members/members-attention-summary.server";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await loadMembersAttentionSummary(sessionId);
  return NextResponse.json({ ok: true, summary });
}
