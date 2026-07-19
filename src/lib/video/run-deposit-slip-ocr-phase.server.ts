import "server-only";

import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getObject } from "@/lib/storage";
import {
  clearDepositSlipOcrChunkState,
  depositSlipOcrChunkWindow,
  readDepositSlipOcrChunkState,
  resolveDepositSlipOcrFrameChunkSize,
  resolveDepositSlipOcrResumeOffset,
  writeDepositSlipOcrChunkState,
  type DepositSlipOcrChunkState,
} from "@/lib/video/deposit-slip-ocr-chunks.shared";
import type { ExtractedFrame } from "@/lib/video/frame-extractor";
import { mockOcrDepositSlipFrames } from "@/lib/video/ocr-mock";
import type {
  VideoOcrEngine,
  VideoOcrProgressCallback,
} from "@/lib/video/ocr-provider.shared";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  finalizeDepositSlipVideoParse,
  ocrDepositSlipVideoFrameChunk,
} from "@/lib/video/process-deposit-slip-job";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

export type DepositSlipOcrPhaseResult =
  | {
      kind: "complete";
      parseSessionId: string;
      hqAllianceId: string;
      rowCount: number;
      matchedCount: number;
      ocrFrameMs: number[];
      ocrConcurrency: number;
      totalRawOcrRows: number;
      totalFrames: number;
      ocrCompletedThrough: number;
    }
  | {
      kind: "continue";
      hqAllianceId: string;
      ocrFrameMs: number[];
      ocrConcurrency: number;
      totalRawOcrRows: number;
      totalFrames: number;
      ocrCompletedThrough: number;
      nextFrameOffset: number;
    };

async function loadStoredDepositFrames(jobId: string) {
  const db = getDb();
  return db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      storageKey: schema.videoFrames.storageKey,
      ocrRawJson: schema.videoFrames.ocrRawJson,
      videoTimestampSeconds: schema.videoFrames.videoTimestampSeconds,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, jobId))
    .orderBy(asc(schema.videoFrames.frameIndex));
}

/**
 * OCR the next deposit-slip frame chunk. When more frames remain, updates
 * chunk state, keeps the job in-flight (`parsing`), and dispatches the next
 * worker invocation. When the last chunk finishes, creates the parse session.
 */
export async function runDepositSlipOcrPhase(input: {
  jobId: string;
  sessionId: string;
  scoreTargetId: string;
  target: ScoreTargetDef;
  engine: VideoOcrEngine;
  /** Fresh extract buffers (first invocation). Ignored when frames already stored. */
  extractedFrames: ExtractedFrame[];
  timingsJson: unknown;
  timer: PipelineTimer;
  now: Date;
  onOcrProgress: VideoOcrProgressCallback;
  setChunkProgress: (params: {
    totalFrames: number;
    completedThrough: number;
  }) => Promise<void>;
  /**
   * Persist chunk cursor + progress. Keep status in-flight (`parsing`) so the
   * queue cron does not double-dispatch the same job while we fire-and-forget
   * the next worker invocation.
   */
  setContinueChunk: (params: {
    totalFrames: number;
    nextFrameOffset: number;
    timingsJson: Record<string, unknown>;
  }) => Promise<void>;
  /** When the next-chunk worker trigger fails, requeue for cron backup. */
  requeueAfterChunkDispatchFailed?: (params: {
    timingsJson: Record<string, unknown>;
  }) => Promise<void>;
}): Promise<DepositSlipOcrPhaseResult> {
  const db = getDb();
  let stored = await loadStoredDepositFrames(input.jobId);

  // First invocation: caller already wrote extracted frames to storage.
  if (stored.length === 0 && input.extractedFrames.length > 0) {
    stored = await loadStoredDepositFrames(input.jobId);
  }

  const totalFrames =
    stored.length > 0 ? stored.length : input.extractedFrames.length;
  if (totalFrames === 0) {
    throw new Error("Deposit slip job has no frames to OCR.");
  }

  const storedState = readDepositSlipOcrChunkState(input.timingsJson);
  const chunkSize =
    storedState?.chunkSize ?? resolveDepositSlipOcrFrameChunkSize();
  const nextFrameOffset = resolveDepositSlipOcrResumeOffset({
    storedState,
    frames: stored,
  });

  if (nextFrameOffset >= totalFrames) {
    const finalized = await finalizeDepositSlipVideoParse({
      jobId: input.jobId,
      sessionId: input.sessionId,
      scoreTargetId: input.scoreTargetId,
      timer: input.timer,
      now: input.now,
    });
    const cleared = clearDepositSlipOcrChunkState(
      (input.timingsJson as Record<string, unknown> | null) ?? {},
    );
    await db
      .update(schema.videoJobs)
      .set({ timingsJson: cleared, updatedAt: input.now })
      .where(eq(schema.videoJobs.id, input.jobId));
    return {
      kind: "complete",
      parseSessionId: finalized.parseSessionId,
      hqAllianceId: finalized.hqAllianceId,
      rowCount: finalized.rowCount,
      matchedCount: finalized.matchedCount,
      ocrFrameMs: [],
      ocrConcurrency: 1,
      totalRawOcrRows: 0,
      totalFrames,
      ocrCompletedThrough: totalFrames,
    };
  }

  const window = depositSlipOcrChunkWindow({
    nextFrameOffset,
    totalFrames,
    chunkSize,
  });

  await input.setChunkProgress({
    totalFrames,
    completedThrough: nextFrameOffset,
  });

  let chunkFrames: Array<{ index: number; buffer: Buffer }>;
  if (stored.length > 0) {
    chunkFrames = [];
    for (let i = window.start; i < window.end; i += 1) {
      const row = stored[i];
      if (!row) {
        throw new Error(
          `Missing stored frame ${i} for deposit slip job ${input.jobId}`,
        );
      }
      const buffer = await getObject(row.storageKey);
      chunkFrames.push({ index: row.frameIndex, buffer });
    }
  } else {
    chunkFrames = input.extractedFrames
      .slice(window.start, window.end)
      .map((frame) => ({ index: frame.index, buffer: frame.buffer }));
  }

  // Mock fixtures are whole-video; only load them on the first chunk so
  // later chunks do not re-insert the same slips when histories are merged.
  const mockHistory =
    input.engine === "mock"
      ? nextFrameOffset === 0
        ? await input.timer.measureStep("mock.deposit_slip_ocr_total", () =>
            mockOcrDepositSlipFrames(
              input.scoreTargetId,
              chunkFrames.map((f) => ({ index: f.index })),
            ),
          )
        : {
            depositPolicy: null,
            minimumDeposit: null,
            slips: [],
          }
      : undefined;

  const chunkResult = await ocrDepositSlipVideoFrameChunk({
    jobId: input.jobId,
    sessionId: input.sessionId,
    engine: input.engine,
    frames: chunkFrames,
    timer: input.timer,
    now: input.now,
    mockHistory,
    onOcrProgress: async (completedInChunk) => {
      await input.onOcrProgress(
        nextFrameOffset + completedInChunk,
        totalFrames,
      );
    },
  });

  const ocrCompletedThrough = window.end;

  if (!window.isFinal) {
    const chunkState: DepositSlipOcrChunkState = {
      version: 1,
      nextFrameOffset: ocrCompletedThrough,
      totalFrames,
      chunkSize,
    };
    const nextTimings = writeDepositSlipOcrChunkState(
      (input.timingsJson as Record<string, unknown> | null) ?? {},
      chunkState,
    );
    await input.setContinueChunk({
      totalFrames,
      nextFrameOffset: ocrCompletedThrough,
      timingsJson: nextTimings,
    });
    const dispatched = await dispatchVideoProcessing(input.jobId, {
      source: "deposit_slip_ocr_chunk",
      awaitResult: true,
    });
    if (!dispatched) {
      await input.requeueAfterChunkDispatchFailed?.({
        timingsJson: nextTimings,
      });
    }
    return {
      kind: "continue",
      hqAllianceId: chunkResult.hqAllianceId,
      ocrFrameMs: chunkResult.ocrFrameMs,
      ocrConcurrency: chunkResult.ocrConcurrency,
      totalRawOcrRows: chunkResult.totalRawOcrRows,
      totalFrames,
      ocrCompletedThrough,
      nextFrameOffset: ocrCompletedThrough,
    };
  }

  const finalized = await finalizeDepositSlipVideoParse({
    jobId: input.jobId,
    sessionId: input.sessionId,
    scoreTargetId: input.scoreTargetId,
    timer: input.timer,
    now: input.now,
  });

  const cleared = clearDepositSlipOcrChunkState(
    (input.timingsJson as Record<string, unknown> | null) ?? {},
  );
  await db
    .update(schema.videoJobs)
    .set({ timingsJson: cleared, updatedAt: input.now })
    .where(eq(schema.videoJobs.id, input.jobId));

  return {
    kind: "complete",
    parseSessionId: finalized.parseSessionId,
    hqAllianceId: finalized.hqAllianceId,
    rowCount: finalized.rowCount,
    matchedCount: finalized.matchedCount,
    ocrFrameMs: chunkResult.ocrFrameMs,
    ocrConcurrency: chunkResult.ocrConcurrency,
    totalRawOcrRows: chunkResult.totalRawOcrRows,
    totalFrames,
    ocrCompletedThrough,
  };
}

/** True when this job already has stored frames and should skip ffmpeg extract. */
export async function shouldSkipDepositSlipExtract(
  jobId: string,
): Promise<boolean> {
  const frames = await loadStoredDepositFrames(jobId);
  return frames.length > 0;
}
