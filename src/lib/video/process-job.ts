import { eq } from "drizzle-orm";

import { resolveSessionAllianceId, getSessionAllianceTag } from "@/lib/alliance/session-alliance";
import {
  trackVideoPipelineFailure,
  trackVideoPipelineTimings,
  type VideoProcessTimings,
} from "@/lib/analytics/video-pipeline";
import { writeAuditLog } from "@/lib/bff/audit";
import { base44ListMembers } from "@/lib/base44/fetch";
import { getAshedConnection } from "@/lib/session";
import { getDb, schema } from "@/lib/db";
import { getObject, putObject, frameStorageKey } from "@/lib/storage";
import {
  cleanupFrameTempDir,
  extractLeaderboardFrames,
} from "@/lib/video/frame-extractor";
import {
  buildMemberIndex,
  matchMemberName,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { ocrAllFrames } from "@/lib/video/ocr-pipeline";
import { collapseEntriesBySanitizedName } from "@/lib/video/normalize-rows";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

export type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";

export async function resetVideoJobForReprocess(jobId: string): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.parseSessionId) {
    await db
      .delete(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));
    await db
      .delete(schema.parseSessions)
      .where(eq(schema.parseSessions.id, job.parseSessionId));
  }

  await db.delete(schema.videoFrames).where(eq(schema.videoFrames.jobId, jobId));

  await db
    .update(schema.videoJobs)
    .set({
      status: "queued",
      parseSessionId: null,
      frameCount: null,
      uploadedFrameCount: 0,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.videoJobs.id, jobId));

  await emitVideoJobStatus({
    sessionId: job.sessionId,
    jobId,
    status: "queued",
    fileName: job.fileName,
    scoreTarget: job.scoreTarget ?? job.category,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
  });
}

export async function processVideoJob(
  jobId: string,
  options?: { analyticsSource?: "api" | "worker" },
): Promise<VideoProcessTimings> {
  const timer = new PipelineTimer();
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (!job.storageKey) {
    throw new Error("Job has no stored video.");
  }

  const connection = await getAshedConnection(job.sessionId);
  if (!connection) {
    throw new Error("Ashed not connected for this session.");
  }

  const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
  const target = getScoreTargetOrThrow(scoreTargetId);
  const now = new Date();

  const setStatus = async (
    status: string,
    extra: Partial<typeof schema.videoJobs.$inferInsert> = {},
    meta?: { rowCount?: number; matchedCount?: number },
  ) => {
    const updatedAt = new Date();
    await db
      .update(schema.videoJobs)
      .set({ status, updatedAt, ...extra })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      sessionId: job.sessionId,
      jobId,
      status,
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      frameCount: extra.frameCount ?? job.frameCount,
      uploadedFrameCount:
        extra.uploadedFrameCount ?? job.uploadedFrameCount,
      rowCount: meta?.rowCount,
      matchedCount: meta?.matchedCount,
      errorMessage:
        typeof extra.errorMessage === "string"
          ? extra.errorMessage
          : job.errorMessage,
      updatedAt: updatedAt.toISOString(),
    });
  };

  let frameCount = 0;
  let rowCount = 0;
  let matchedCount = 0;
  let ocrFrameMs: number[] = [];

  try {
    await setStatus("extracting");
    await writeAuditLog({
      sessionId: job.sessionId,
      allianceId: job.allianceId,
      action: "video.extract_start",
      resourceType: "video_job",
      resourceName: scoreTargetId,
      resourceId: jobId,
      metadata: { fileName: job.fileName },
    });

    const videoBuffer = await timer.measure("load_video", () =>
      getObject(job.storageKey!),
    );
    const tmpVideo = path.join(
      os.tmpdir(),
      `hq-video-${jobId}${path.extname(job.fileName ?? ".mp4")}`,
    );
    await fs.writeFile(tmpVideo, videoBuffer);

    let frames: Awaited<ReturnType<typeof extractLeaderboardFrames>> = [];
    try {
      frames = await timer.measure("ffmpeg_extract", () =>
        extractLeaderboardFrames(tmpVideo),
      );
    } finally {
      await fs.unlink(tmpVideo).catch(() => undefined);
    }

    frameCount = frames.length;

    await timer.measure("store_frames", async () => {
      for (const frame of frames) {
        const key = frameStorageKey(jobId, frame.index);
        await putObject(key, frame.buffer);
        await db.insert(schema.videoFrames).values({
          id: nanoid(16),
          jobId,
          frameIndex: frame.index,
          storageKey: key,
          createdAt: now,
        });
      }
    });

    await setStatus("parsing", {
      frameCount: frames.length,
      uploadedFrameCount: 0,
    });

    const allianceId = await timer.measure("resolve_alliance", () =>
      resolveSessionAllianceId(job.sessionId, connection),
    );

    const { entries: rawEntries, frameTimings } = await timer.measure("ocr_total", () =>
      ocrAllFrames(
        connection,
        target,
        frames.map((f) => ({ index: f.index, buffer: f.buffer })),
      ),
    );
    ocrFrameMs = frameTimings.map((f) => f.ms);

    const allianceTag = await getSessionAllianceTag(job.sessionId);
    const { entries, unresolvedConflicts } = collapseEntriesBySanitizedName(
      rawEntries,
      allianceTag,
    );
    rowCount = entries.length;

    await cleanupFrameTempDir(frames);

    await setStatus("parsing", { uploadedFrameCount: frames.length });

    let members: AshedMember[] = [];
    try {
      members = await timer.measure("member_fetch", () =>
        base44ListMembers(connection, allianceId),
      );
    } catch {
      members = [];
    }

    const parseSessionId = nanoid(16);
    await db.insert(schema.parseSessions).values({
      id: parseSessionId,
      jobId,
      sessionId: job.sessionId,
      scoreTarget: scoreTargetId,
      allianceId,
      rowCount: entries.length,
      matchedCount: 0,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    const memberIndex = members.length ? buildMemberIndex(members) : null;

    await timer.measure("member_match_persist", async () => {
      matchedCount = 0;
      for (const entry of entries) {
        const match = memberIndex
          ? matchMemberName(entry.name, memberIndex, { allianceTag })
          : {
              ocrName: entry.name,
              memberId: null,
              memberName: null,
              confidence: 0,
              matchMethod: "none" as const,
            };
        if (match.memberId) matchedCount++;

        await db.insert(schema.parsedRows).values({
          id: nanoid(16),
          parseSessionId,
          ocrName: entry.name,
          score: String(entry.score),
          rank: entry.rank ?? null,
          memberId: match.memberId,
          memberName: match.memberName,
          matchConfidence: match.confidence,
          matchMethod: match.matchMethod,
          scoreConflict: entry.scoreConflict ? 1 : 0,
          frameIndex: null,
          deleted: 0,
          edited: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    await db
      .update(schema.parseSessions)
      .set({ matchedCount, rowCount: entries.length, updatedAt: new Date() })
      .where(eq(schema.parseSessions.id, parseSessionId));

    await setStatus(
      "review",
      {
        parseSessionId,
        allianceId,
      },
      { rowCount: entries.length, matchedCount },
    );

    const phases = timer.getPhases();
    const ocrFrameAvgMs =
      ocrFrameMs.length > 0
        ? ocrFrameMs.reduce((sum, ms) => sum + ms, 0) / ocrFrameMs.length
        : null;

    const timings: VideoProcessTimings = {
      jobId,
      scoreTarget: scoreTargetId,
      fileSizeBytes: job.fileSizeBytes,
      frameCount,
      rowCount,
      matchedCount,
      totalMs: timer.getTotalMs(),
      phases,
      ocrFrameMs,
      ocrFrameAvgMs,
    };

    timer.log(`job ${jobId} complete`, {
      scoreTarget: scoreTargetId,
      frameCount,
      rowCount,
      matchedCount,
      ocrFrameMs,
    });

    await writeAuditLog({
      sessionId: job.sessionId,
      allianceId,
      action: "video.parse_complete",
      resourceType: "parse_session",
      resourceName: scoreTargetId,
      resourceId: parseSessionId,
      metadata: {
        jobId,
        frameCount,
        rowCount,
        matchedCount,
        unresolvedScoreConflicts: unresolvedConflicts,
        timings: {
          totalMs: timings.totalMs,
          phases,
          ocrFrameAvgMs,
        },
      },
    });

    void trackVideoPipelineTimings(timings, {
      jobId,
      scoreTarget: scoreTargetId,
      source: options?.analyticsSource ?? "api",
    });

    return timings;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video processing failed";
    await setStatus("failed", { errorMessage: message });
    timer.log(`job ${jobId} failed`, { error: message });
    void trackVideoPipelineFailure(
      jobId,
      scoreTargetId,
      message,
      timer.getTotalMs(),
    );
    await writeAuditLog({
      sessionId: job.sessionId,
      allianceId: job.allianceId,
      action: "video.failed",
      resourceType: "video_job",
      resourceId: jobId,
      metadata: {
        error: message,
        totalMs: timer.getTotalMs(),
        phases: timer.getPhases(),
      },
    });
    throw error;
  }
}
