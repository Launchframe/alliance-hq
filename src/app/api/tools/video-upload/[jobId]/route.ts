import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
} from "@/lib/members/roster.server";
import { getOrCreateSession } from "@/lib/session";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { isVideoProcessTimings } from "@/lib/video/pipeline-stats-display";
import { resolveJobVideoStorageKey } from "@/lib/video/resolve-job-video-storage";
import {
  getScoreTarget,
  isMemberRosterVideoTarget,
  toScoreTargetClientMeta,
} from "@/lib/video/score-targets";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }
    const job = access.job;
    const db = getDb();

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";

    let parseSession = null;
    let rows: Array<{
      id: string;
      ocrName: string;
      score: string | null;
      rank: number | null;
      rosterRankRaw: string | null;
      allianceRank: number | null;
      allianceRankTitle: string | null;
      powerLevel: string | null;
      memberLevel: number | null;
      profession: string | null;
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
          .orderBy(
            isMemberRosterVideoTarget(scoreTargetId)
              ? asc(schema.parsedRows.allianceRank)
              : asc(schema.parsedRows.rank),
            asc(schema.parsedRows.frameIndex),
          );
        rows = dbRows.map((r) => ({
          id: r.id,
          ocrName: r.ocrName,
          score: r.score,
          rank: r.rank,
          rosterRankRaw: r.rosterRankRaw,
          allianceRank: r.allianceRank,
          allianceRankTitle: r.allianceRankTitle,
          powerLevel: r.powerLevel,
          memberLevel: r.memberLevel,
          profession: r.profession,
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

    const target = getScoreTarget(scoreTargetId);

    const timingsJson = isVideoProcessTimings(job.timingsJson)
      ? (job.timingsJson as VideoProcessTimings)
      : null;

    const storageKey = await resolveJobVideoStorageKey({
      storageKey: job.storageKey,
      archiveStorageKey: job.archiveStorageKey,
      groupId: job.groupId,
      fileName: job.fileName,
    });

    const dbFrames = await db
      .select({
        frameIndex: schema.videoFrames.frameIndex,
        videoTimestampSeconds: schema.videoFrames.videoTimestampSeconds,
      })
      .from(schema.videoFrames)
      .where(eq(schema.videoFrames.jobId, jobId))
      .orderBy(asc(schema.videoFrames.frameIndex));

    const frameTimestamps: Record<string, number> = {};
    for (const frame of dbFrames) {
      if (
        frame.videoTimestampSeconds != null &&
        Number.isFinite(frame.videoTimestampSeconds)
      ) {
        frameTimestamps[String(frame.frameIndex)] = frame.videoTimestampSeconds;
      }
    }

    let jobAllianceTag: string | null = session.allianceTag;
    let jobAllianceName: string | null = null;
    const allianceIdForJob = job.allianceId ?? parseSession?.allianceId ?? null;
    let members: AshedMember[] = [];
    if (allianceIdForJob) {
      const [allianceRow] = await db
        .select({
          tag: schema.alliances.tag,
          name: schema.alliances.name,
        })
        .from(schema.alliances)
        .where(eq(schema.alliances.id, allianceIdForJob))
        .limit(1);
      if (allianceRow?.tag) {
        jobAllianceTag = allianceRow.tag.trim();
      }
      jobAllianceName = allianceRow?.name ?? null;

      // Local HQ roster for the job's alliance — works on any device without
      // the viewer's personal Ashed credential (cross-device review).
      const rosterRows = await listAllianceMembers(allianceIdForJob);
      members = rosterRows
        .map(allianceMemberRowToAshedMember)
        .sort((a, b) =>
          a.current_name.localeCompare(b.current_name, undefined, {
            sensitivity: "base",
          }),
        );
    }

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
        rating: job.rating,
        timingsJson,
      },
      hasSourceVideo: storageKey != null,
      frameTimestamps,
      scoreTargetMeta: target ? toScoreTargetClientMeta(target) : null,
      alliance: {
        jobId: job.allianceId,
        currentId: session.allianceId,
        currentTag: session.allianceTag,
        jobTag: jobAllianceTag,
        jobName: jobAllianceName,
        stale:
          Boolean(session.allianceId && job.parseSessionId) &&
          job.allianceId !== session.allianceId,
      },
      parseSession,
      rows,
      members,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load job" },
      { status: 500 },
    );
  }
}
