import { NextResponse } from "next/server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import {
  filterAshedScoresByDate,
  fetchAshedScoresForAlliance,
} from "@/lib/data-management/ashed-date-scores.server";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import { getScoreTarget } from "@/lib/video/score-targets";
import { getAshedConnection } from "@/lib/session";

type Props = {
  params: Promise<{ recordedDate: string }>;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * GET /api/data-management/dates/[recordedDate]/scores?scoreTarget=...
 * All Ashed score rows for a date (Team A + B together), mirroring Ashed admin UI.
 */
export async function GET(request: Request, { params }: Props) {
  try {
    const { recordedDate } = await params;
    if (!isIsoDate(recordedDate)) {
      return NextResponse.json(
        { error: "recordedDate must be YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const ctx = await resolveDataManagementApiContext();
    if (ctx instanceof NextResponse) return ctx;

    const url = new URL(request.url);
    const scoreTarget = url.searchParams.get("scoreTarget")?.trim() ?? "";
    const target = getScoreTarget(scoreTarget);
    if (!target) {
      return NextResponse.json({ error: "Unknown score target." }, { status: 400 });
    }

    const connection = await getAshedConnection(ctx.sessionId);
    if (!connection) {
      return NextResponse.json(
        { error: "Ashed not connected", code: "ashed_not_connected" },
        { status: 503 },
      );
    }

    const ashedAllianceId = await getAshedAllianceIdIfLinked(ctx.allianceId);
    if (!ashedAllianceId) {
      return NextResponse.json(
        { error: "Alliance is not linked to Ashed." },
        { status: 409 },
      );
    }

    const rows = await fetchAshedScoresForAlliance(
      connection,
      target.submitEntity,
      ashedAllianceId,
    );
    const filtered = filterAshedScoresByDate(rows, recordedDate);

    return NextResponse.json({
      recordedDate,
      scoreTarget: target.id,
      scores: filtered.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
        score: row.score,
        rank: row.rank,
        team: row.team,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load scores",
      },
      { status: 500 },
    );
  }
}
