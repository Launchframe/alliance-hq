import { eq, and } from "drizzle-orm";

import { resolveSessionAllianceId, getSessionAllianceTag } from "@/lib/alliance/session-alliance";
import {
  trackVideoPipelineFailure,
  trackVideoPipelineTimings,
  type VideoProcessTimings,
} from "@/lib/analytics/video-pipeline";
import { writeAuditLog } from "@/lib/bff/audit";
import { base44ListMembers } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { resolveHqAllianceIdFromSession } from "@/lib/members/resolve-hq-alliance";
import { isValidRosterOcrConfig } from "@/lib/members/roster-ocr/roster-ocr-config";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
} from "@/lib/members/roster.server";
import { getAshedConnection } from "@/lib/session";
import { getDb, schema } from "@/lib/db";
import { putObject, frameStorageKey, prefersLocalStorage, r2Configured, streamObjectToFile } from "@/lib/storage";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";
import {
  cleanupFrameTempDir,
  extractLeaderboardFrames,
} from "@/lib/video/frame-extractor";
import {
  buildMemberIndex,
  matchMemberName,
  type AshedMember,
} from "@/lib/video/member-matcher";
import { ocrAllFrames, defaultAshFrameConcurrency } from "@/lib/video/ocr-pipeline";
import { collapseEntriesBySanitizedName } from "@/lib/video/normalize-rows";
import { dedupeMatchedParseEntries } from "@/lib/video/parse-row-dedup";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import { processRosterVideoParse } from "@/lib/video/process-roster-job";
import {
  getScoreTargetOrThrow,
  isMemberRosterVideoTarget,
} from "@/lib/video/score-targets";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { maybeEnqueueShadowPass } from "@/lib/video/enqueue-shadow-pass";
import {
  AshedNotConnectedError,
  isAshedNotConnectedError,
} from "@/lib/video/errors";
import { dispatchVideoArchive } from "@/lib/video/trigger-archive";
import { computePassComparison } from "@/lib/video/compare-pass-results";
import { mergeGroupComparisons } from "@/lib/video/group-comparisons.shared";
import { mockOcrScoreFrames } from "@/lib/video/ocr-mock";
import {
  engineRequiresAshed,
  resolveVideoJobAshedConnection,
  resolveVideoOcrEngineForJob,
  shouldEnqueueAshedOcrShadowPasses,
} from "@/lib/video/ocr-provider.shared";
import { resolveJobVideoStorageKey } from "@/lib/video/resolve-job-video-storage";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
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
      timingsJson: null,
      totalFileSizeBytes: null,
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

  if (job.passRole === "tesseract_shadow") {
    const { processTesseractShadowRosterJob } = await import(
      "@/lib/video/process-tesseract-shadow-roster-job"
    );
    return processTesseractShadowRosterJob(jobId, options);
  }

  const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
  const isRosterTarget = isMemberRosterVideoTarget(scoreTargetId);
  const ocrEngine = resolveVideoOcrEngineForJob(scoreTargetId, isRosterTarget);
  const now = new Date();

  /**
   * OCR runs against the approving processor's Ashed credential. Legacy jobs
   * predating the enqueue/process split fall back to the uploader session.
   */
  const processingSessionId = job.processingSessionId ?? job.sessionId;

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
  let ocrConcurrency = 0;
  let ashedUploadTotalMs: number | null = null;
  let ashedExtractTotalMs: number | null = null;
  let videoDurationSeconds: number | null = null;
  let denseFrameCount: number | null = null;
  let framesSkipped: number | null = null;
  let totalRawOcrRows: number | null = null;

  try {
    const videoStorageKey = await resolveJobVideoStorageKey(job);
    if (!videoStorageKey) {
      throw new Error("Job has no stored video.");
    }

    const connection = (await resolveVideoJobAshedConnection({
      engine: ocrEngine,
      loadConnection: () => getAshedConnection(processingSessionId),
    })) as ParsedConnection | null;

    if (engineRequiresAshed(ocrEngine) && !connection) {
      // Recoverable: revert to pending so a connected processor can re-approve.
      await db
        .update(schema.videoJobs)
        .set({
          status: "pending_approval",
          processingSessionId: null,
          approvedByHqUserId: null,
          approvedAt: null,
          errorMessage: "awaiting_ashed_connection",
          updatedAt: new Date(),
        })
        .where(eq(schema.videoJobs.id, jobId));
      await emitVideoJobStatus({
        sessionId: job.sessionId,
        jobId,
        status: "pending_approval",
        fileName: job.fileName,
        scoreTarget: scoreTargetId,
        frameCount: null,
        uploadedFrameCount: 0,
        errorMessage: "awaiting_ashed_connection",
      });
      throw new AshedNotConnectedError();
    }

    const target = getScoreTargetOrThrow(scoreTargetId);

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

    const tmpVideo = path.join(
      os.tmpdir(),
      `hq-video-${jobId}${path.extname(job.fileName ?? ".mp4")}`,
    );
    const videoBytes = await timer.measureStep("storage.load_video", () =>
      streamObjectToFile(videoStorageKey, tmpVideo),
      (bytes) => ({ bytes }),
    );
    logPipelineStep("storage.temp_video_ready", 0, { bytes: videoBytes, jobId });

    const extractionConfig = (job.extractionConfigJson as ExtractionConfig | null) ?? undefined;

    let frames: import("@/lib/video/frame-extractor").ExtractedFrame[] = [];
    try {
      const extractResult = await timer.measureStep("ffmpeg.extract", () =>
        extractLeaderboardFrames(tmpVideo, extractionConfig),
        (result) => ({ frameCount: result.frames.length }),
      );
      frames = extractResult.frames;
      videoDurationSeconds = extractResult.videoDurationSeconds;
      denseFrameCount = extractResult.denseFrameCount;
      framesSkipped = extractResult.framesSkipped;
    } finally {
      await timer.measureStep("storage.delete_temp_video", () =>
        fs.unlink(tmpVideo).catch(() => undefined),
      );
    }

    frameCount = frames.length;
    const totalFrameBytes = frames.reduce((sum, frame) => sum + frame.buffer.length, 0);
    const avgFrameBytes =
      frames.length > 0 ? Math.round(totalFrameBytes / frames.length) : 0;

    logPipelineStep("frames.summary", 0, {
      frameCount: frames.length,
      totalBytes: totalFrameBytes,
      avgBytes: avgFrameBytes,
      concurrency: defaultAshFrameConcurrency(),
      jobId,
    });

    for (const frame of frames) {
      await timer.measureStep("storage.put_frame", async () => {
        const key = frameStorageKey(jobId, frame.index);
        await putObject(key, frame.buffer);
        await db.insert(schema.videoFrames).values({
          id: nanoid(16),
          jobId,
          frameIndex: frame.index,
          storageKey: key,
          videoTimestampSeconds: frame.videoTimestampSeconds,
          createdAt: now,
        });
      }, { frameIndex: frame.index, bytes: frame.buffer.length });
    }

    const storageBucket = prefersLocalStorage()
      ? "local .data/uploads"
      : "R2 hq-videos";
    logPipelineStep("storage.frames_written", 0, {
      frameCount: frames.length,
      totalBytes: totalFrameBytes,
      bucket: storageBucket,
      jobId,
    });
    if (prefersLocalStorage()) {
      logPipelineStep("storage.frames_local", 0, {
        path: path.join(process.cwd(), ".data", "uploads", "videos", jobId, "frames"),
        jobId,
      });
    } else if (r2Configured()) {
      logPipelineStep("storage.frames_local", 0, {
        path: `r2://${process.env.R2_BUCKET ?? "hq-videos"}/videos/${jobId}/frames/`,
        jobId,
      });
    }

    await setStatus("parsing", {
      frameCount: frames.length,
      uploadedFrameCount: 0,
    });

    let allianceId: string;
    let parseSessionId: string;
    let unresolvedConflicts: string[] = [];

    if (isRosterTarget) {
      const rosterConfig = isValidRosterOcrConfig(job.extractionConfigJson)
        ? job.extractionConfigJson
        : undefined;
      const rosterResult = await processRosterVideoParse({
        jobId,
        sessionId: processingSessionId,
        scoreTargetId,
        target,
        connection: engineRequiresAshed(ocrEngine) ? connection : null,
        engine: ocrEngine,
        rosterConfig,
        rosterPassKey: job.passKey,
        frames: frames.map((f) => ({ index: f.index, buffer: f.buffer })),
        timer,
        now,
      });

      allianceId = rosterResult.hqAllianceId;
      parseSessionId = rosterResult.parseSessionId;
      rowCount = rosterResult.rowCount;
      matchedCount = rosterResult.matchedCount;
      ocrFrameMs = rosterResult.ocrFrameMs;
      ocrConcurrency = rosterResult.ocrConcurrency;
      ashedUploadTotalMs = rosterResult.ashedUploadTotalMs;
      ashedExtractTotalMs = rosterResult.ashedExtractTotalMs;
      totalRawOcrRows = rosterResult.totalRawOcrRows;

      await timer.measureStep("storage.cleanup_frame_temp", () =>
        cleanupFrameTempDir(frames),
        { frameCount: frames.length },
      );

      await setStatus("parsing", { uploadedFrameCount: frames.length });
    } else {
      if (ocrEngine === "mock") {
        allianceId = await timer.measureStep("alliance.resolve_hq", () =>
          resolveHqAllianceIdFromSession(processingSessionId),
        );

        const rawEntries = await timer.measureStep(
          "mock.ocr_total",
          () =>
            mockOcrScoreFrames(
              scoreTargetId,
              frames.map((f) => ({ index: f.index })),
              { allianceId },
            ),
          (entries) => ({ rowCount: entries.length }),
        );

        ocrFrameMs = frames.map(() => 1);
        ocrConcurrency = 1;
        ashedUploadTotalMs = 0;
        ashedExtractTotalMs = 0;
        totalRawOcrRows = rawEntries.length;

        const allianceTag = await timer.measureStep("alliance.load_tag", () =>
          getSessionAllianceTag(job.sessionId),
        );
        const { entries, unresolvedConflicts: collapsedConflicts } =
          await timer.measureStep(
            "parse.collapse_rows",
            async () =>
              collapseEntriesBySanitizedName(rawEntries, allianceTag),
            (result) => ({
              inputRows: rawEntries.length,
              outputRows: result.entries.length,
              conflicts: result.unresolvedConflicts,
            }),
          );
        unresolvedConflicts = collapsedConflicts;
        rowCount = entries.length;

        await timer.measureStep("storage.cleanup_frame_temp", () =>
          cleanupFrameTempDir(frames),
          { frameCount: frames.length },
        );

        await setStatus("parsing", { uploadedFrameCount: frames.length });

        const hqMembers = await listAllianceMembers(allianceId);
        const members = hqMembers.map(allianceMemberRowToAshedMember);

        parseSessionId = nanoid(16);
        await timer.measureStep("db.create_parse_session", async () => {
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
        }, { rowCount: entries.length });

        const memberIndex = members.length ? buildMemberIndex(members) : null;

        await timer.measureStep(
          "parse.match_and_persist",
          async () => {
            const matchedRows = entries.map((entry) => ({
              entry,
              match: memberIndex
                ? matchMemberName(entry.name, memberIndex, { allianceTag })
                : {
                    ocrName: entry.name,
                    memberId: null,
                    memberName: null,
                    confidence: 0,
                    matchMethod: "none" as const,
                  },
            }));

            const dedupedRows = dedupeMatchedParseEntries(matchedRows, allianceTag);
            rowCount = dedupedRows.length;
            matchedCount = 0;

            for (const { entry, match } of dedupedRows) {
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
                frameIndex: entry._sourceFrameIndex ?? null,
                deleted: 0,
                edited: 0,
                createdAt: now,
                updatedAt: now,
              });
            }
            return matchedCount;
          },
          (count) => ({ matchedCount: count, rowCount }),
        );

        await timer.measureStep("db.update_parse_session", async () => {
          await db
            .update(schema.parseSessions)
            .set({ matchedCount, rowCount, updatedAt: new Date() })
            .where(eq(schema.parseSessions.id, parseSessionId));
        });
      } else {
      allianceId = await timer.measureStep("alliance.resolve", () =>
        resolveSessionAllianceId(processingSessionId, connection!),
      );

    const { entries: rawEntries, frameTimings, concurrency } =
      await timer.measureStep(
        "ashed.ocr_total",
        () =>
          ocrAllFrames(
            connection!,
            target,
            frames.map((f) => ({ index: f.index, buffer: f.buffer })),
            { timer, jobId },
          ),
        (result) => ({
          frameCount: frames.length,
          concurrency: result.concurrency,
          rowCount: result.entries.length,
        }),
      );
    ocrFrameMs = frameTimings.map((f) => f.ms);
    ocrConcurrency = concurrency;
    ashedUploadTotalMs = frameTimings.reduce((sum, f) => sum + f.uploadMs, 0);
    ashedExtractTotalMs = frameTimings.reduce((sum, f) => sum + f.extractMs, 0);
    totalRawOcrRows = frameTimings.reduce((sum, f) => sum + (f.entryCount ?? 0), 0);

    await Promise.all(
      frameTimings.map((timing) =>
        db
          .update(schema.videoFrames)
          .set({
            uploadMs: timing.uploadMs,
            extractMs: timing.extractMs,
            ocrEntryCount: timing.entryCount,
            ocrError: timing.error,
            ocrRawJson: timing.rawResult ?? null,
          })
          .where(
            and(
              eq(schema.videoFrames.jobId, jobId),
              eq(schema.videoFrames.frameIndex, timing.frameIndex),
            ),
          ),
      ),
    );

    const allianceTag = await timer.measureStep("alliance.load_tag", () =>
      getSessionAllianceTag(job.sessionId),
    );
    const { entries, unresolvedConflicts: collapsedConflicts } =
      await timer.measureStep(
      "parse.collapse_rows",
      async () =>
        collapseEntriesBySanitizedName(rawEntries, allianceTag),
      (result) => ({
        inputRows: rawEntries.length,
        outputRows: result.entries.length,
        conflicts: result.unresolvedConflicts,
      }),
    );
    unresolvedConflicts = collapsedConflicts;
    rowCount = entries.length;

    await timer.measureStep("storage.cleanup_frame_temp", () =>
      cleanupFrameTempDir(frames),
      { frameCount: frames.length },
    );

    await setStatus("parsing", { uploadedFrameCount: frames.length });

    let members: AshedMember[] = [];
    try {
      members = await timer.measureStep(
        "ashed.list_members",
        () => base44ListMembers(connection!, allianceId),
        (result) => ({ count: result.length }),
      );
    } catch {
      members = [];
    }

    parseSessionId = nanoid(16);
    await timer.measureStep("db.create_parse_session", async () => {
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
    }, { rowCount: entries.length });

    const memberIndex = members.length ? buildMemberIndex(members) : null;

    await timer.measureStep(
      "parse.match_and_persist",
      async () => {
        const matchedRows = entries.map((entry) => ({
          entry,
          match: memberIndex
            ? matchMemberName(entry.name, memberIndex, { allianceTag })
            : {
                ocrName: entry.name,
                memberId: null,
                memberName: null,
                confidence: 0,
                matchMethod: "none" as const,
              },
        }));

        const dedupedRows = dedupeMatchedParseEntries(matchedRows, allianceTag);
        rowCount = dedupedRows.length;
        matchedCount = 0;

        for (const { entry, match } of dedupedRows) {
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
            frameIndex: entry._sourceFrameIndex ?? null,
            deleted: 0,
            edited: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        return matchedCount;
      },
      (count) => ({ matchedCount: count, rowCount }),
    );

    await timer.measureStep("db.update_parse_session", async () => {
      await db
        .update(schema.parseSessions)
        .set({ matchedCount, rowCount, updatedAt: new Date() })
        .where(eq(schema.parseSessions.id, parseSessionId));
    });
      }
    }

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
      ocrConcurrency,
      ashedUploadTotalMs,
      ashedExtractTotalMs,
      videoDurationSeconds: videoDurationSeconds ?? null,
      denseFrameCount: denseFrameCount ?? null,
      framesSkipped: framesSkipped ?? null,
      totalRawOcrRows,
    };

    await setStatus(
      "review",
      {
        parseSessionId,
        allianceId,
        timingsJson: timings,
        totalFileSizeBytes: totalFrameBytes,
      },
      { rowCount, matchedCount },
    );

    if (allianceId) {
      const { notifyEurVideoEvidence } = await import("@/lib/eur/satisfaction");
      void notifyEurVideoEvidence(allianceId).catch(() => {});
    }

    void dispatchVideoArchive(jobId);

    timer.log(`job ${jobId} complete`, {
      scoreTarget: scoreTargetId,
      frameCount,
      rowCount,
      matchedCount,
      ocrConcurrency,
      ashedUploadTotalMs,
      ashedExtractTotalMs,
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
          ocrConcurrency,
          ashedUploadTotalMs,
          ashedExtractTotalMs,
        },
      },
    });

    void trackVideoPipelineTimings(timings, {
      jobId,
      scoreTarget: scoreTargetId,
      source: options?.analyticsSource ?? "api",
    });

    // Shadow pass enqueue (primary jobs only, fire-and-forget)
    const shadowEnqueueJob = {
      id: job.id,
      sessionId: job.sessionId,
      processingSessionId: job.processingSessionId ?? null,
      allianceId: job.allianceId ?? null,
      scoreTarget: job.scoreTarget ?? null,
      category: job.category ?? null,
      storageKey: job.storageKey ?? null,
      boardKey: job.boardKey ?? null,
      hqEventId: job.hqEventId ?? null,
      groupId: job.groupId ?? null,
      passRole: job.passRole ?? null,
      frameCount: job.frameCount ?? null,
      hqUserId: job.hqUserId ?? null,
    };

    try {
      if (shouldEnqueueAshedOcrShadowPasses(ocrEngine)) {
        await maybeEnqueueShadowPass({
          job: shadowEnqueueJob,
          totalMs: timings.totalMs,
          frameCount,
        });
      }
    } catch {
      // Shadow pass failure must not fail primary job
    }

    if (isRosterTarget && shouldEnqueueAshedOcrShadowPasses(ocrEngine)) {
      try {
        const { maybeEnqueueTesseractShadowPass } = await import(
          "@/lib/video/enqueue-tesseract-shadow-pass"
        );
        await maybeEnqueueTesseractShadowPass({ job: shadowEnqueueJob });
      } catch {
        // Tesseract shadow failure must not fail primary job
      }
    }

    // If this is a shadow pass, compute cross-pass comparison and persist to group
    if (job.passRole === "shadow" && job.groupId) {
      try {
        const [group] = await db
          .select({
            primaryJobId: schema.videoUploadGroups.primaryJobId,
            comparisonJson: schema.videoUploadGroups.comparisonJson,
          })
          .from(schema.videoUploadGroups)
          .where(eq(schema.videoUploadGroups.id, job.groupId))
          .limit(1);

        if (group?.primaryJobId) {
          const comparison = await computePassComparison(group.primaryJobId, job.id);
          await db
            .update(schema.videoUploadGroups)
            .set({
              comparisonJson: mergeGroupComparisons(group.comparisonJson, {
                extraction_shadow: comparison,
              }),
              updatedAt: new Date(),
            })
            .where(eq(schema.videoUploadGroups.id, job.groupId));
        }
      } catch {
        // Comparison failure must not fail shadow job
      }
    }

    return timings;
  } catch (error) {
    // Missing Ashed credential is recoverable — the job was already reverted to
    // pending_approval above. Do not mark it failed or record a pipeline failure.
    if (isAshedNotConnectedError(error)) {
      throw error;
    }
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
