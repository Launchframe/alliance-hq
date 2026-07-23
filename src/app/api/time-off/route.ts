import { NextResponse } from "next/server";

import { loadTimeOffCalendar } from "@/lib/time-off/load-dashboard.server";
import {
  requireTimeOffAllianceContext,
  requireTimeOffRead,
} from "@/lib/time-off/route-helpers.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await requireTimeOffAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, session, allianceId } = context;
  const denied = await requireTimeOffRead(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const month = url.searchParams.get("month");

  const dashboard = await loadTimeOffCalendar({
    sessionId,
    hqUserId: session.hqUserId ?? null,
    allianceId,
    month,
  });

  if ("forbidden" in dashboard) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(dashboard);
}
