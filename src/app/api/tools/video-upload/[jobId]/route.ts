import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import {
  getScoreTarget,
  toScoreTargetClientMeta,
} from "@/lib/video/score-targets";
import { isVideoProcessTimings } from "@/lib/video/pipeline-stats-display";

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
      frameIndex: number | null;
      memberId: string | null;
      memberName: string | null;
      matchConfidence: number | null;
      matchMethod: string | null;
      scoreConflict: number;
      deleted: number;
      manuallyAdded: number;
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
          .where(eq(schema.parsedRows.parseSessionId, ps.id))
          .orderBy(asc(schema.parsedRows.rank), asc(schema.parsedRows.frameIndex));
        rows = dbRows.map((r) => ({
          id: r.id,
          ocrName: r.ocrName,
          score: r.score,
          rank: r.rank,
          frameIndex: r.frameIndex,
          memberId: r.memberId,
          memberName: r.memberName,
          matchConfidence: r.matchConfidence,
          matchMethod: r.matchMethod,
          scoreConflict: r.scoreConflict,
          deleted: r.deleted,
          manuallyAdded: r.manuallyAdded,
        }));
      }
    }

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const target = getScoreTarget(scoreTargetId);

    const timingsJson = isVideoProcessTimings(job.timingsJson)
      ? (job.timingsJson as VideoProcessTimings)
      : null;

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
        timingsJson,
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
