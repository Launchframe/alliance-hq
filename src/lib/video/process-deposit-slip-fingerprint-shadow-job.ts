import "server-only";

import { asc, eq } from "drizzle-orm";
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

async function loadPrimaryJobFrames(primaryJobId: string) {
  const db = getDb();
  const frameRows = await db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      storageKey: schema.videoFrames.storageKey,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, primaryJobId))
    .orderBy(asc(schema.videoFrames.frameIndex));

  const frames: Array<{ index: number; buffer: Buffer }> = [];
  for (const frame of frameRows) {
    const buffer = await getObject(frame.storageKey);
    frames.push({ index: frame.frameIndex, buffer });
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

    await setStatus("parsing");

    const frames = await timer.measureStep(
      "storage.load_primary_frames",
      () => loadPrimaryJobFrames(group.primaryJobId!),
      (loaded) => ({ frameCount: loaded.length }),
    );

    const ocrFrameMs: number[] = [];
    const frameLines: OcrFrameLines[] = [];

    // Single shared tesseract.js worker (same as the primary native path) —
    // sequential, not concurrent, so this never contends with itself.
    for (const frame of frames) {
      const started = Date.now();
      const { buffer: processed, height } = await preprocessRosterImage(
        frame.buffer,
        DEFAULT_ROSTER_OCR_CONFIG,
      );
      const ocrLines = await runTesseract(processed, DEFAULT_ROSTER_OCR_CONFIG);
      ocrFrameMs.push(Date.now() - started);
      frameLines.push({
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
    const hqAllianceId = primaryJob?.allianceId ?? job.allianceId;

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
      frameCount: frames.length,
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
        frameCount: frames.length,
        uploadedFrameCount: frames.length,
      },
      { rowCount: history.slips.length },
    );

    void trackVideoPipelineTimings(timings, {
      jobId,
      scoreTarget: scoreTargetId,
      source: options?.analyticsSource ?? "api",
    });

    try {
      await maybeCompareDepositSlipFingerprintShadow({ groupId: job.groupId });
    } catch (err) {
      console.error(
        "[deposit-slip-fingerprint-shadow] comparison-on-shadow-complete failed",
        err,
      );
    }

    return timings;
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
