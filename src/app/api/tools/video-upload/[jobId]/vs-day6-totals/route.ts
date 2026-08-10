import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { requireApiSession } from "@/lib/session";
import { fetchAllianceVsDay1To5CoverageForDay6 } from "@/lib/trains/vs-scores.server";
import { vsPerformanceDayNumberForDate } from "@/lib/video/vs-recorded-date.shared";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/tools/video-upload/[jobId]/vs-day6-totals
 * ?recordedDate=YYYY-MM-DD (Saturday / VS Day 6)
 *
 * Returns per-member Days 1–5 totals for deriving Day 6-only scores from
 * cumulative post-match screenshots.
 */
export async function GET(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const { jobId } = await params;
    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const { searchParams } = new URL(request.url);
    const recordedDate = searchParams.get("recordedDate")?.trim() ?? "";

    if (!recordedDate) {
      return NextResponse.json(
        { error: "recordedDate is required." },
        { status: 400 },
      );
    }

    if (!DATE_PATTERN.test(recordedDate)) {
      return NextResponse.json(
        { error: "recordedDate must be YYYY-MM-DD." },
        { status: 400 },
      );
    }

    if (vsPerformanceDayNumberForDate(recordedDate) !== 6) {
      return NextResponse.json(
        { error: "recordedDate must be a VS Day 6 (Saturday) match date." },
        { status: 400 },
      );
    }

    const scoreTargetId =
      access.job.scoreTarget ?? access.job.category ?? "vs-performance";
    if (scoreTargetId !== "vs-performance") {
      return NextResponse.json({ totals: {} });
    }

    const allianceId =
      access.job.allianceId ?? resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ totals: {} });
    }

    const coverageMap = await fetchAllianceVsDay1To5CoverageForDay6(
      allianceId,
      recordedDate,
    );

    const totals: Record<string, { total: number; daysCovered: number }> = {};
    for (const [memberId, coverage] of coverageMap) {
      totals[memberId] = coverage;
    }

    return NextResponse.json({ totals });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load VS Day 6 coverage totals",
      },
      { status: 500 },
    );
  }
}
