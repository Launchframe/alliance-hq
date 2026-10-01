import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";
import { retryVsScoresForContext } from "@/lib/vs-scores/sync.server";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  loadVsVideoEvidence,
  loadVsVideoEvidenceRow,
  resolveVsVideoAccess,
} from "@/lib/vs-performance/video-evidence.server";
import { vsVideoWeekStart } from "@/lib/vs-performance/video-evidence.shared";
import { vsScope } from "@/lib/vs-performance/vs-scope.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

const bodySchema = z
  .object({ target: z.enum(["scores", "matchup"]) })
  .strict();

type Props = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const body = bodySchema.parse(await request.json());
    const access = await resolveVsVideoAccess(
      session.id,
      jobId,
      body.target === "matchup" ? "review" : "read",
    );
    const row = await loadVsVideoEvidenceRow(access);
    if (!row) throw new VsPerformanceError("stale", 409);
    const context = { recordedDate: row.recordedDate, period: row.period };
    if (body.target === "scores") {
      if (
        !(await sessionHasPermissionForAlliance(
          session.id,
          access.actor.allianceId,
          "scores:write",
        ))
      ) {
        throw new VsPerformanceError("forbidden", 403);
      }
      await retryVsScoresForContext(
        access.actor.allianceId,
        context.recordedDate,
        context.period,
      );
    } else {
      const evidence = await loadVsVideoEvidence(access);
      if (evidence.ashedLinked) {
        const weekStart = vsVideoWeekStart(context);
        const { syncAshedOpponentInfo } = await import(
          "@/lib/vs-performance/matchup-sync.server"
        );
        await syncAshedOpponentInfo(
          access.actor,
          {
            weekStart,
            scope: vsScope(access.actor, weekStart),
            reason: "sync",
          },
          false,
        );
      }
    }
    return NextResponse.json(await loadVsVideoEvidence(access));
  } catch (error) {
    return vsErrorResponse(error);
  }
}
