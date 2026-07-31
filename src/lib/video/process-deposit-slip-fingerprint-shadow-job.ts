import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  trackVideoPipelineFailure,
  trackVideoPipelineTimings,
  type VideoProcessTimings,
} from "@/lib/analytics/video-pipeline";
import { getDb, schema } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  dedupeOcrLinesAcrossFrames,
  type OcrFrameLines,
} from "@/lib/banks/deposit-slip-ocr/row-fingerprint.shared";
import {
  mergeDepositSlipHistoryParses,
  parseDepositSlipHistoryText,
  BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET,
} from "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-text.shared";
import { depositSlipDraftToParsedRowFields } from "@/lib/banks/deposit-slip-ocr/draft-row.shared";
import { maybeCompareDepositSlipFingerprintShadow } from "@/lib/banks/deposit-slip-ocr/deposit-slip-shadow-comparison.server";
import {
  claimDepositSlipFingerprintShadowChunk,
  releaseDepositSlipFingerprintShadowChunkClaim,
} from "@/lib/video/deposit-slip-ocr-chunk-claim.server";
import {
  depositSlipOcrChunkWindow,
  fingerprintShadowHasPersistedChunkState,
  readDepositSlipFingerprintShadowChunkState,
  resolveDepositSlipOcrFrameChunkSize,
  writeDepositSlipFingerprintShadowChunkState,
  type DepositSlipFingerprintShadowChunkState,
} from "@/lib/video/deposit-slip-fingerprint-shadow-chunks.shared";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

async function loadPrimaryFrameMeta(primaryJobId: string) {
  const db = getDb();
  return db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      storageKey: schema.videoFrames.storageKey,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, primaryJobId))
    .orderBy(asc(schema.videoFrames.frameIndex));
}

async function loadPrimaryFrameBuffers(
  frameRows: ReadonlyArray<{ frameIndex: number; storageKey: string }>,
  start: number,
  end: number,
): Promise<Array<{ index: number; buffer: Buffer }>> {
  const frames: Array<{ index: number; buffer: Buffer }> = [];
  for (let i = start; i < end; i += 1) {
    const row = frameRows[i];
    if (!row) {
      throw new Error(`Missing primary frame at offset ${i}`);
    }
    const buffer = await getObject(row.storageKey);
    frames.push({ index: row.frameIndex, buffer });
  }
  return frames;
}

/**
 * Deposit-slip row-fingerprint shadow pass processor.
 *
 * Runs entirely after the primary job — see
 * `enqueue-deposit-slip-fingerprint-shadow-pass.ts` for the fire-and-forget
 * enqueue point in `process-job.ts`. Reuses the primary job's already-
 * extracted frames from R2 (no re-extraction), OCRs each frame with the same
 * roster-preprocess + Tesseract pipeline as the primary native path, but
 * dedupes lines *across frames* (`dedupeOcrLinesAcrossFrames`) before
 * domain-parsing, instead of parsing every frame independently and
 * reconciling slip-level duplicates afterward.
 *
 * OCR is chunked like the primary deposit-slip path (`depositSlipOcrChunk`)
 * so long videos stay under the video-process maxDuration. Partial OCR lines
 * live on the shadow job's `timingsJson` until the final chunk finalizes.
 *
 * The shadow job's own `parsed_rows` are for instrumentation only — they are
 * never surfaced in the review UI and never committed to
 * `bank_deposit_slips`. Comparison against the primary job's *submitted*
 * rows happens in `deposit-slip-shadow-comparison.server.ts`, triggered from
 * here (in case the primary was already submitted first) and from the
 * submit route (in case this shadow job finishes first).
 */
export async function processDepositSlipFingerprintShadowJob(
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

  if (job.passRole !== "deposit_slip_fingerprint_shadow") {
    throw new Error("Not a deposit-slip fingerprint shadow job.");
  }

  if (!job.groupId) {
    throw new Error("Deposit-slip fingerprint shadow job is missing groupId.");
  }

  const scoreTargetId =
    job.scoreTarget ?? job.category ?? BANK_DEPOSIT_SLIP_HISTORY_SCORE_TARGET;
  const now = new Date();

  const setStatus = async (
    status: string,
    extra: Partial<typeof schema.videoJobs.$inferInsert> = {},
    meta?: { rowCount?: number },
  ) => {
    const updatedAt = new Date();
    await db
      .update(schema.videoJobs)
      .set({ status, updatedAt, ...extra })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status,
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      frameCount: extra.frameCount ?? job.frameCount,
      uploadedFrameCount: extra.uploadedFrameCount ?? job.uploadedFrameCount,
      rowCount: meta?.rowCount,
      errorMessage:
        typeof extra.errorMessage === "string"
          ? extra.errorMessage
          : job.errorMessage,
      updatedAt: updatedAt.toISOString(),
    });
  };

  const emptyTimings = (): VideoProcessTimings => ({
    jobId,
    scoreTarget: scoreTargetId,
    fileSizeBytes: job.fileSizeBytes,
    frameCount: job.frameCount ?? 0,
    rowCount: 0,
    matchedCount: 0,
    totalMs: 0,
    phases: {},
    ocrFrameMs: [],
    ocrFrameAvgMs: null,
    ocrConcurrency: 1,
    ashedUploadTotalMs: null,
    ashedExtractTotalMs: null,
    videoDurationSeconds: null,
    denseFrameCount: null,
    framesSkipped: null,
    totalRawOcrRows: null,
  });

  const timingsFromJob = (): VideoProcessTimings => {
    const raw = job.timingsJson;
    if (
      raw &&
      typeof raw === "object" &&
      "totalMs" in raw &&
      typeof (raw as { totalMs?: unknown }).totalMs === "number"
    ) {
      return raw as VideoProcessTimings;
    }
    return emptyTimings();
  };

  // Already finished — never re-OCR. Re-attempt comparison in case submit
  // landed while a prior run skipped it.
  if (job.status === "complete") {
    if (job.groupId) {
      try {
        await maybeCompareDepositSlipFingerprintShadow({ groupId: job.groupId });
      } catch (err) {
        console.error(
          "[deposit-slip-fingerprint-shadow] comparison-on-reentry failed",
          err,
        );
      }
    }
    return timingsFromJob();
  }

  const existingChunk = readDepositSlipFingerprintShadowChunkState(
    job.timingsJson,
  );
  const isChunkContinuation =
    job.status === "parsing" &&
    fingerprintShadowHasPersistedChunkState(existingChunk);

  // Claim queued/failed → parsing. Continuation chunks stay in `parsing` and
  // re-enter here via the next-chunk worker dispatch (same as primary).
  if (!isChunkContinuation) {
    const [claimed] = await db
      .update(schema.videoJobs)
      .set({ status: "parsing", errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          inArray(schema.videoJobs.status, ["queued", "failed"]),
        ),
      )
      .returning({ id: schema.videoJobs.id });

    if (!claimed) {
      const [fresh] = await db
        .select({
          status: schema.videoJobs.status,
          timingsJson: schema.videoJobs.timingsJson,
          groupId: schema.videoJobs.groupId,
        })
        .from(schema.videoJobs)
        .where(eq(schema.videoJobs.id, jobId))
        .limit(1);

      if (fresh?.status === "complete" && fresh.groupId) {
        try {
          await maybeCompareDepositSlipFingerprintShadow({
            groupId: fresh.groupId,
          });
        } catch (err) {
          console.error(
            "[deposit-slip-fingerprint-shadow] comparison-on-lost-claim failed",
            err,
          );
        }
        if (
          fresh.timingsJson &&
          typeof fresh.timingsJson === "object" &&
          "totalMs" in fresh.timingsJson &&
          typeof (fresh.timingsJson as { totalMs?: unknown }).totalMs ===
            "number"
        ) {
          return fresh.timingsJson as VideoProcessTimings;
        }
      }

      // Another worker is already parsing a non-continuation run — no-op.
      return emptyTimings();
    }

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "parsing",
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      frameCount: job.frameCount,
      uploadedFrameCount: job.uploadedFrameCount,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });
  }

  try {
    const [group] = await db
      .select({
        primaryJobId: schema.videoUploadGroups.primaryJobId,
        boardKey: schema.videoUploadGroups.boardKey,
        hqEventId: schema.videoUploadGroups.hqEventId,
      })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);

    if (!group?.primaryJobId) {
      throw new Error("Upload group has no primary job.");
    }

    const [primaryJob] = await db
      .select({ allianceId: schema.videoJobs.allianceId })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, group.primaryJobId))
      .limit(1);

    const frameRows = await timer.measureStep(
      "storage.load_primary_frame_meta",
      () => loadPrimaryFrameMeta(group.primaryJobId!),
      (loaded) => ({ frameCount: loaded.length }),
    );

    const totalFrames = frameRows.length;
    if (totalFrames === 0) {
      throw new Error("Primary job has no frames for fingerprint shadow OCR.");
    }

    const chunkSize =
      existingChunk?.chunkSize ?? resolveDepositSlipOcrFrameChunkSize();
    const nextFrameOffset = Math.min(
      existingChunk?.nextFrameOffset ?? 0,
      totalFrames,
    );
    const priorFrameLines = existingChunk?.frameLines ?? [];
    const priorOcrFrameMs = existingChunk?.ocrFrameMs ?? [];

    if (nextFrameOffset >= totalFrames) {
      // Cursor says done but we never finalized (e.g. crash after last chunk
      // write). Finalize from persisted lines.
      return await finalizeFingerprintShadowFromLines({
        jobId,
        job,
        groupId: job.groupId,
        scoreTargetId,
        hqAllianceId: primaryJob?.allianceId ?? job.allianceId,
        frameLines: priorFrameLines,
        ocrFrameMs: priorOcrFrameMs,
        totalFrames,
        timer,
        now,
        setStatus,
        analyticsSource: options?.analyticsSource,
      });
    }

    const window = depositSlipOcrChunkWindow({
      nextFrameOffset,
      totalFrames,
      chunkSize,
    });

    const claim = await claimDepositSlipFingerprintShadowChunk({
      jobId,
      expectedOffset: nextFrameOffset,
      totalFrames,
      chunkSize,
      priorChunk: existingChunk,
      priorTimingsJson:
        (job.timingsJson as Record<string, unknown> | null) ?? null,
      now,
    });
    if (!claim.claimed) {
      timer.log(
        `deposit-slip fingerprint shadow job ${jobId} lost chunk claim; no-op`,
        { nextFrameOffset, totalFrames },
      );
      return emptyTimings();
    }

    await setStatus("parsing", {
      frameCount: totalFrames,
      uploadedFrameCount: nextFrameOffset,
    });

    const chunkFrames = await timer.measureStep(
      "storage.load_primary_frame_chunk",
      () => loadPrimaryFrameBuffers(frameRows, window.start, window.end),
      { frameCount: window.frameCount },
    );

    const chunkFrameLines: OcrFrameLines[] = [];
    const chunkOcrFrameMs: number[] = [];

    // Single shared tesseract.js worker (same as the primary native path) —
    // sequential, not concurrent, so this never contends with itself.
    for (const frame of chunkFrames) {
      const started = Date.now();
      const { buffer: processed, height } = await preprocessRosterImage(
        frame.buffer,
        DEFAULT_ROSTER_OCR_CONFIG,
      );
      const ocrLines = await runTesseract(processed, DEFAULT_ROSTER_OCR_CONFIG);
      chunkOcrFrameMs.push(Date.now() - started);
      chunkFrameLines.push({
        frameIndex: frame.index,
        lines: ocrLines.map((line) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox ?? null,
          rowHeight: line.rowHeight ?? null,
        })),
        frameHeight: height,
      });
    }

    const frameLines = [...priorFrameLines, ...chunkFrameLines];
    const ocrFrameMs = [...priorOcrFrameMs, ...chunkOcrFrameMs];
    const ocrCompletedThrough = window.end;

    if (!window.isFinal) {
      const chunkState: DepositSlipFingerprintShadowChunkState =
        releaseDepositSlipFingerprintShadowChunkClaim({
          version: 1,
          nextFrameOffset: ocrCompletedThrough,
          totalFrames,
          chunkSize,
          frameLines,
          ocrFrameMs,
        });
      const nextTimings = writeDepositSlipFingerprintShadowChunkState(
        claim.timingsJson,
        chunkState,
      );
      await setStatus("parsing", {
        frameCount: totalFrames,
        uploadedFrameCount: ocrCompletedThrough,
        timingsJson: nextTimings,
      });

      const dispatched = await dispatchVideoProcessing(jobId, {
        source: "deposit_slip_fingerprint_shadow_chunk",
      });
      if (!dispatched) {
        // Cron/queue backup — keep chunk progress, leave job claimable.
        await setStatus("queued", {
          timingsJson: nextTimings,
          frameCount: totalFrames,
          uploadedFrameCount: ocrCompletedThrough,
        });
      }

      timer.log(
        `deposit-slip fingerprint shadow job ${jobId} OCR chunk complete; continuing`,
        {
          nextFrameOffset: ocrCompletedThrough,
          totalFrames,
          chunkSize,
        },
      );

      return {
        jobId,
        scoreTarget: scoreTargetId,
        fileSizeBytes: job.fileSizeBytes,
        frameCount: totalFrames,
        rowCount: 0,
        matchedCount: 0,
        totalMs: timer.getTotalMs(),
        phases: timer.getPhases(),
        ocrFrameMs: chunkOcrFrameMs,
        ocrFrameAvgMs:
          chunkOcrFrameMs.length > 0
            ? chunkOcrFrameMs.reduce((sum, ms) => sum + ms, 0) /
              chunkOcrFrameMs.length
            : null,
        ocrConcurrency: 1,
        ashedUploadTotalMs: null,
        ashedExtractTotalMs: null,
        videoDurationSeconds: null,
        denseFrameCount: null,
        framesSkipped: null,
        totalRawOcrRows: null,
      };
    }

    return await finalizeFingerprintShadowFromLines({
      jobId,
      job,
      groupId: job.groupId,
      scoreTargetId,
      hqAllianceId: primaryJob?.allianceId ?? job.allianceId,
      frameLines,
      ocrFrameMs,
      totalFrames,
      timer,
      now,
      setStatus,
      analyticsSource: options?.analyticsSource,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Deposit-slip fingerprint shadow processing failed";
    await setStatus("failed", { errorMessage: message });
    timer.log(`deposit-slip fingerprint shadow job ${jobId} failed`, {
      error: message,
    });
    void trackVideoPipelineFailure(
      jobId,
      scoreTargetId,
      message,
      timer.getTotalMs(),
    );
    throw error;
  }
}

async function finalizeFingerprintShadowFromLines(params: {
  jobId: string;
  job: typeof schema.videoJobs.$inferSelect;
  groupId: string;
  scoreTargetId: string;
  hqAllianceId: string | null;
  frameLines: OcrFrameLines[];
  ocrFrameMs: number[];
  totalFrames: number;
  timer: PipelineTimer;
  now: Date;
  setStatus: (
    status: string,
    extra?: Partial<typeof schema.videoJobs.$inferInsert>,
    meta?: { rowCount?: number },
  ) => Promise<void>;
  analyticsSource?: "api" | "worker";
}): Promise<VideoProcessTimings> {
  const db = getDb();
  const {
    jobId,
    job,
    groupId,
    scoreTargetId,
    hqAllianceId,
    frameLines,
    ocrFrameMs,
    totalFrames,
    timer,
    now,
    setStatus,
    analyticsSource,
  } = params;

  const dedupeResult = await timer.measureStep(
    "fingerprint.dedupe_lines_across_frames",
    () => Promise.resolve(dedupeOcrLinesAcrossFrames(frameLines)),
    (result) => ({
      rawLineCount: result.rawLineCount,
      uniqueLineCount: result.uniqueLineCount,
    }),
  );

  const parsed = parseDepositSlipHistoryText(dedupeResult.lines);
  const { history } = mergeDepositSlipHistoryParses([parsed]);

  const parseSessionId = nanoid(16);

  await timer.measureStep(
    "db.create_shadow_parse_session",
    async () => {
      await db.insert(schema.parseSessions).values({
        id: parseSessionId,
        jobId,
        sessionId: job.sessionId,
        scoreTarget: scoreTargetId,
        allianceId: hqAllianceId,
        rowCount: history.slips.length,
        matchedCount: 0,
        status: "closed",
        // Not a DedupeReport (that shape is cluster-flag bookkeeping for the
        // primary review UI) — just enough for the comparison job to report
        // this shadow pass's own line-level dedupe effect on the dashboard.
        dedupeReportJson: {
          rawLineCount: dedupeResult.rawLineCount,
          uniqueLineCount: dedupeResult.uniqueLineCount,
        },
        createdAt: now,
        updatedAt: now,
      });
    },
    { rowCount: history.slips.length },
  );

  if (history.slips.length > 0) {
    await timer.measureStep(
      "db.persist_shadow_rows",
      async () => {
        await db.insert(schema.parsedRows).values(
          history.slips.map((slip) => {
            const fields = depositSlipDraftToParsedRowFields(slip);
            return {
              id: nanoid(16),
              parseSessionId,
              ocrName: fields.ocrName,
              score: fields.score,
              rank: fields.rank,
              rosterRankRaw: fields.rosterRankRaw,
              allianceRank: null,
              allianceRankTitle: fields.allianceRankTitle,
              powerLevel: fields.powerLevel,
              memberLevel: fields.memberLevel,
              profession: fields.profession,
              memberId: null,
              memberName: null,
              matchConfidence: null,
              matchMethod: "none",
              scoreConflict: 0,
              frameIndex: fields.frameIndex,
              deleted: 0,
              edited: 0,
              manuallyAdded: 0,
              createdAt: now,
              updatedAt: now,
            };
          }),
        );
      },
      { rowCount: history.slips.length },
    );
  }

  const ocrFrameAvgMs =
    ocrFrameMs.length > 0
      ? ocrFrameMs.reduce((sum, ms) => sum + ms, 0) / ocrFrameMs.length
      : null;

  const timings: VideoProcessTimings = {
    jobId,
    scoreTarget: scoreTargetId,
    fileSizeBytes: job.fileSizeBytes,
    frameCount: totalFrames,
    rowCount: history.slips.length,
    matchedCount: 0,
    totalMs: timer.getTotalMs(),
    phases: timer.getPhases(),
    ocrFrameMs,
    ocrFrameAvgMs,
    ocrConcurrency: 1,
    ashedUploadTotalMs: null,
    ashedExtractTotalMs: null,
    videoDurationSeconds: null,
    denseFrameCount: null,
    framesSkipped: null,
    totalRawOcrRows: dedupeResult.rawLineCount,
  };

  await setStatus(
    "complete",
    {
      parseSessionId,
      allianceId: hqAllianceId,
      timingsJson: timings,
      frameCount: totalFrames,
      uploadedFrameCount: totalFrames,
    },
    { rowCount: history.slips.length },
  );

  void trackVideoPipelineTimings(timings, {
    jobId,
    scoreTarget: scoreTargetId,
    source: analyticsSource ?? "api",
  });

  try {
    await maybeCompareDepositSlipFingerprintShadow({ groupId });
  } catch (err) {
    console.error(
      "[deposit-slip-fingerprint-shadow] comparison-on-shadow-complete failed",
      err,
    );
  }

  return timings;
}
