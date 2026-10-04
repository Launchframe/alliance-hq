import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  vsActorForSession,
  vsErrorResponse,
} from "@/lib/vs-performance/api-helpers.server";
import { saveVsMatchupIdentity } from "@/lib/vs-performance/match-results.server";
import { loadVsPerformanceWeek } from "@/lib/vs-performance/weekly-plan.server";
import { attemptVsOpponentSync } from "@/lib/vs-performance/matchup-sync.server";
import {
  VsPerformanceError,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  try {
    await saveVsMatchupIdentity(actor, body);
    const parsed = vsWeekStartSchema.safeParse(
      (body as { weekStart?: unknown })?.weekStart,
    );
    if (parsed.success) {
      try {
        await attemptVsOpponentSync(actor, parsed.data);
      } catch {
      }
      const week = await loadVsPerformanceWeek(actor.sessionId, parsed.data, actor);
      return NextResponse.json({ ...week.matchup, week });
    }
    return vsErrorResponse(new VsPerformanceError("invalid", 400));
  } catch (error) {
    return vsErrorResponse(error);
  }
}
