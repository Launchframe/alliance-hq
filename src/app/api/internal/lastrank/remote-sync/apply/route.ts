import { NextResponse } from "next/server";

import { parseLastRankRemoteApplyRequest } from "@/lib/lastrank/remote-sync.shared";
import {
  applyLastRankRemoteSync,
  isLastRankRemoteSyncAuthorized,
} from "@/lib/lastrank/remote-sync.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Matched-row updates include Last War name lookups and Ashed PUTs per member.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isLastRankRemoteSyncAuthorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseLastRankRemoteApplyRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await applyLastRankRemoteSync(parsed.value);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[lastrank] remote apply failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "apply failed" },
      { status: 500 },
    );
  }
}
