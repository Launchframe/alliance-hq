import { NextResponse } from "next/server";

import { parseLastRankRemotePlanRequest } from "@/lib/lastrank/remote-sync.shared";
import {
  isLastRankRemoteSyncAuthorized,
  planLastRankRemoteSync,
} from "@/lib/lastrank/remote-sync.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!isLastRankRemoteSyncAuthorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = parseLastRankRemotePlanRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const plan = await planLastRankRemoteSync(parsed.value.target);
    return NextResponse.json(plan);
  } catch (error) {
    console.error("[lastrank] remote plan failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "plan failed" },
      { status: 500 },
    );
  }
}
