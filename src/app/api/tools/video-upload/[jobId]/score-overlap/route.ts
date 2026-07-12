import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";
import { isStormTeam } from "@/lib/video/storm-score-overlap.shared";
import { findStormScoreOverlap } from "@/lib/video/storm-score-overlap.server";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/tools/video-upload/[jobId]/score-overlap
 * ?eventId=&team=A|B&recordedDate=YYYY-MM-DD
 *
 * Warns when Desert/Canyon Storm scores already exist for the same
 * event type + team + date (Ashed and/or prior HQ submits).
 */
export async function GET(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const { searchParams } = new URL(request.url);
    const team = searchParams.get("team");
    const recordedDate = searchParams.get("recordedDate")?.trim() ?? "";
    const eventId = searchParams.get("eventId")?.trim() || null;

    if (!isStormTeam(team) || !recordedDate) {
      return NextResponse.json(
        { error: "team and recordedDate are required." },
        { status: 400 },
      );
    }

    if (!DATE_PATTERN.test(recordedDate)) {
      return NextResponse.json(
        { error: "recordedDate must be YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const scoreTargetId =
      access.job.scoreTarget ?? access.job.category ?? "desert-storm";
    const target = getScoreTargetOrThrow(scoreTargetId);
    if (!target.submitContext.includes("team")) {
      return NextResponse.json({ overlaps: false, source: null });
    }

    const allianceId =
      access.job.allianceId ?? resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ overlaps: false, source: null });
    }

    const connection = await getAshedConnection(session.id);
    const ashedAllianceId = await getAshedAllianceIdIfLinked(allianceId);
    const result = await findStormScoreOverlap({
      connection,
      allianceId,
      ashedAllianceId,
      scoreTargetId,
      eventId,
      team,
      recordedDate,
      excludeJobId: jobId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check for existing scores",
      },
      { status: 500 },
    );
  }
}
