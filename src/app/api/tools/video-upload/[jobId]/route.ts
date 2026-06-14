import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import {
  getScoreTarget,
  toScoreTargetClientMeta,
} from "@/lib/video/score-targets";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const db = getDb();

    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          eq(schema.videoJobs.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    let parseSession = null;
    let rows: Array<{
      id: string;
      ocrName: string;
      score: string;
      rank: number | null;
      memberId: string | null;
      memberName: string | null;
      matchConfidence: number | null;
      matchMethod: string | null;
      scoreConflict: number;
      deleted: number;
    }> = [];

    if (job.parseSessionId) {
      const [ps] = await db
        .select()
        .from(schema.parseSessions)
        .where(eq(schema.parseSessions.id, job.parseSessionId))
        .limit(1);
      parseSession = ps
        ? {
            id: ps.id,
            rowCount: ps.rowCount,
            matchedCount: ps.matchedCount,
            scoreTarget: ps.scoreTarget,
            allianceId: ps.allianceId,
            status: ps.status,
          }
        : null;

      if (ps) {
        const dbRows = await db
          .select()
          .from(schema.parsedRows)
          .where(eq(schema.parsedRows.parseSessionId, ps.id));
        rows = dbRows.map((r) => ({
          id: r.id,
          ocrName: r.ocrName,
          score: r.score,
          rank: r.rank,
          memberId: r.memberId,
          memberName: r.memberName,
          matchConfidence: r.matchConfidence,
          matchMethod: r.matchMethod,
          scoreConflict: r.scoreConflict,
          deleted: r.deleted,
        }));
      }
    }

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const target = getScoreTarget(scoreTargetId);

    return NextResponse.json({
      job: {
        id: job.id,
        status: job.status,
        fileName: job.fileName,
        scoreTarget: scoreTargetId,
        boardKey: job.boardKey,
        commendationId: job.commendationId,
        hqEventId: job.hqEventId,
        frameCount: job.frameCount,
        errorMessage: job.errorMessage,
        parseSessionId: job.parseSessionId,
        allianceId: job.allianceId,
      },
      scoreTargetMeta: target ? toScoreTargetClientMeta(target) : null,
      alliance: {
        jobId: job.allianceId,
        currentId: session.allianceId,
        currentTag: session.allianceTag,
        stale:
          Boolean(session.allianceId && job.parseSessionId) &&
          job.allianceId !== session.allianceId,
      },
      parseSession,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load job" },
      { status: 500 },
    );
  }
}
