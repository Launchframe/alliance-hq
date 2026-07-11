import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { loadPriceIsRightVsLeaderboard } from "@/lib/trains/price-is-right-leaderboard.server";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const trainDate = new URL(request.url).searchParams.get("date")?.trim();
  if (!trainDate || !/^\d{4}-\d{2}-\d{2}$/.test(trainDate)) {
    return NextResponse.json(
      { error: "date query parameter (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  try {
    const payload = await loadPriceIsRightVsLeaderboard({
      allianceId: ctx.allianceId,
      trainDate,
      hqUserId: session.hqUserId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Load failed.";
    const status = message.includes("Price Is Freight") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
