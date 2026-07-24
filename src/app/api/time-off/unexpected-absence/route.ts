import { NextResponse } from "next/server";

import { loadUnexpectedAbsenceReport } from "@/lib/time-off/load-dashboard.server";
import {
  requireTimeOffAllianceContext,
  requireTimeOffWrite,
} from "@/lib/time-off/route-helpers.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

/** Officer report: unexpected absences plus roster members with no planned time off today. */
export async function GET() {
  const context = await requireTimeOffAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireTimeOffWrite(sessionId);
  if (denied) return denied;

  const report = await loadUnexpectedAbsenceReport({ sessionId, allianceId });

  return NextResponse.json({
    asOfDate: getServerCalendarDate(),
    ...report,
  });
}
