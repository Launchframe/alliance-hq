import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44ExtractData,
  base44UploadFile,
} from "@/lib/base44/fetch";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import {
  extractEntries,
  mergeOcrResults,
  type OcrEntry,
} from "@/lib/video/normalize-rows";

export type OcrFrameTiming = {
  frameIndex: number;
  ms: number;
  uploadMs: number;
  extractMs: number;
  entryCount: number;
};

export type OcrAllFramesResult = {
  entries: OcrEntry[];
  frameTimings: OcrFrameTiming[];
  concurrency: number;
};

export function defaultAshFrameConcurrency(): number {
  const parsed = Number(process.env.VIDEO_ASHED_FRAME_CONCURRENCY ?? 4);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 4;
  }
  return Math.min(Math.floor(parsed), 8);
}

export async function ocrFrameBuffer(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  buffer: Buffer,
  frameIndex: number,
  timer?: PipelineTimer,
): Promise<{ entries: OcrEntry[]; uploadMs: number; extractMs: number }> {
  const fileName = `frame_${String(frameIndex).padStart(4, "0")}.jpg`;

  const uploadStarted = Date.now();
  const { file_url } = await base44UploadFile(
    connection,
    fileName,
    "image/jpeg",
    buffer,
  );
  const uploadMs = Date.now() - uploadStarted;
  timer?.logStep("ashed.upload", uploadMs, { frameIndex });

  const extractStarted = Date.now();
  const result = await base44ExtractData(
    connection,
    file_url,
    target.ocrSchema,
  );
  const extractMs = Date.now() - extractStarted;
  timer?.logStep("ashed.extract", extractMs, { frameIndex });

  const entries = extractEntries(result);
  timer?.logStep("ashed.frame", uploadMs + extractMs, {
    frameIndex,
    uploadMs,
    extractMs,
    entryCount: entries.length,
  });

  return { entries, uploadMs, extractMs };
}

export async function ocrAllFrames(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: {
    concurrency?: number;
    timer?: PipelineTimer;
    jobId?: string;
  },
): Promise<OcrAllFramesResult> {
  const concurrency = options?.concurrency ?? defaultAshFrameConcurrency();
  const timer = options?.timer;
  const jobId = options?.jobId;

  timer?.logStep("ashed.batch_start", 0, {
    jobId,
    frameCount: frames.length,
    concurrency,
  });

  const batchStarted = Date.now();
  const frameResults = await mapWithConcurrency(
    frames,
    concurrency,
    async (frame) => {
      const frameStarted = Date.now();
      const { entries, uploadMs, extractMs } = await ocrFrameBuffer(
        connection,
        target,
        frame.buffer,
        frame.index,
        timer,
      );
      return {
        frameIndex: frame.index,
        entries,
        ms: Date.now() - frameStarted,
        uploadMs,
        extractMs,
      };
    },
  );

  timer?.logStep("ashed.batch_complete", Date.now() - batchStarted, {
    jobId,
    frameCount: frames.length,
    concurrency,
  });

  const batches: OcrEntry[][] = [];
  const frameTimings: OcrFrameTiming[] = frameResults
    .sort((a, b) => a.frameIndex - b.frameIndex)
    .map((result) => {
      if (result.entries.length > 0) {
        batches.push(result.entries);
      }
      return {
        frameIndex: result.frameIndex,
        ms: result.ms,
        uploadMs: result.uploadMs,
        extractMs: result.extractMs,
        entryCount: result.entries.length,
      };
    });

  return {
    entries: mergeOcrResults(batches),
    frameTimings,
    concurrency,
  };
}
