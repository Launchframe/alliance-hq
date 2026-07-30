import "server-only";

import { parseRosterImage } from "@/lib/members/roster-ocr/parse-roster-image";
import type {
  AllianceRank,
  ParsedRosterRow,
  RosterOcrConfig,
} from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import {
  attachHqGeometryToOcrRawJson,
  buildRosterFrameHqGeometry,
} from "@/lib/ocr/video-frame-hq-geometry.shared";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  collapseRosterMembersByNameRank,
  type ExtractedRosterMember,
} from "@/lib/video/roster-extract";

/** One frame at a time — native OCR shares a single tesseract.js worker per process. */
export const NATIVE_ROSTER_TESSERACT_CONCURRENCY = 1;

const TESSERACT_FRAME_CONCURRENCY = NATIVE_ROSTER_TESSERACT_CONCURRENCY;

export type NativeRosterFrameTiming = {
  frameIndex: number;
  ms: number;
  entryCount: number;
  error: string | null;
  rawResult?: Record<string, unknown> | null;
};

export type OcrRosterNativeFramesResult = {
  members: ExtractedRosterMember[];
  frameTimings: NativeRosterFrameTiming[];
  concurrency: number;
  lowQuality: boolean;
};

function parsedRosterRowToExtracted(
  row: ParsedRosterRow,
  sourceFrameIndex?: number,
): ExtractedRosterMember {
  return {
    currentName: row.extractedName.trim(),
    rosterRankRaw: `R${row.allianceRank}`,
    allianceRank: row.allianceRank,
    allianceRankTitle: row.allianceRankTitle ?? null,
    powerLevel: row.heroPowerM != null ? `${row.heroPowerM}M` : null,
    heroPowerM: row.heroPowerM ?? null,
    memberLevel: row.memberLevel ?? null,
    profession: null,
    status: null,
    _sourceFrameIndex: sourceFrameIndex,
  };
}

export async function ocrRosterNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: {
    config?: RosterOcrConfig;
    passKey?: string | null;
    concurrency?: number;
    timer?: PipelineTimer;
    jobId?: string;
    onProgress?: VideoOcrProgressCallback;
  },
): Promise<OcrRosterNativeFramesResult> {
  const config = options?.config ?? DEFAULT_ROSTER_OCR_CONFIG;
  const passKey = options?.passKey ?? null;
  const concurrency = Math.min(
    options?.concurrency ?? TESSERACT_FRAME_CONCURRENCY,
    NATIVE_ROSTER_TESSERACT_CONCURRENCY,
  );
  const timer = options?.timer;
  const onProgress = options?.onProgress;
  let completedCount = 0;

  timer?.logStep("tesseract.roster_batch_start", 0, {
    jobId: options?.jobId,
    frameCount: frames.length,
    concurrency,
  });

  // Process frames in order so rank context can carry across scroll positions.
  const sortedFrames = [...frames].sort((a, b) => a.index - b.index);
  let stickyRank: AllianceRank | undefined;
  const frameResults: Array<{
    frameIndex: number;
    ms: number;
    rows: ParsedRosterRow[];
    error: string | null;
    rawResult: Record<string, unknown> | null;
    lowQuality: boolean;
  }> = [];

  for (const frame of sortedFrames) {
    const started = Date.now();
    let sourceWidth = 1080;
    let sourceHeight = 1920;
    try {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(frame.buffer).metadata();
      sourceWidth = meta.width ?? sourceWidth;
      sourceHeight = meta.height ?? sourceHeight;
    } catch {
      // Tests may pass non-image buffers; default dimensions are fine for metrics.
    }
    try {
      const result = await parseRosterImage(frame.buffer, {
        config,
        configPassKey: passKey ?? undefined,
        stickyRank,
      });
      const ms = Date.now() - started;

      if (result.diagnostics?.lastRank != null) {
        stickyRank = result.diagnostics.lastRank;
      }

      logOcrDiagnostics(
        buildOcrDiagnostics({
          source: "video_roster_native",
          durationMs: ms,
          rawLineCount: result.diagnostics?.rawLineCount ?? 0,
          parsedOk: result.rows.length > 0,
          entryCount: result.rows.length,
          frameIndex: frame.index,
          jobId: options?.jobId,
          scoreTarget: "member-roster-video",
        }),
      );

      frameResults.push({
        frameIndex: frame.index,
        ms,
        rows: result.rows,
        error: null,
        rawResult: attachHqGeometryToOcrRawJson(
          result.ocrRawLines ? { lines: result.ocrRawLines } : null,
          buildRosterFrameHqGeometry({
            sourceWidth,
            sourceHeight,
            entryCount: result.rows.length,
            rawLineCount: result.diagnostics?.rawLineCount ?? 0,
            durationMs: ms,
            lowQuality: result.diagnostics?.lowQuality ?? false,
          }),
        ),
        lowQuality: result.diagnostics?.lowQuality ?? false,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tesseract OCR failed";
      logOcrDiagnostics(
        buildOcrDiagnostics({
          source: "video_roster_native",
          durationMs: Date.now() - started,
          rawLineCount: 0,
          parsedOk: false,
          entryCount: 0,
          error: message,
          frameIndex: frame.index,
          jobId: options?.jobId,
          scoreTarget: "member-roster-video",
        }),
      );
      frameResults.push({
        frameIndex: frame.index,
        ms: Date.now() - started,
        rows: [],
        error: message,
        rawResult: attachHqGeometryToOcrRawJson(
          null,
          buildRosterFrameHqGeometry({
            sourceWidth,
            sourceHeight,
            entryCount: 0,
            rawLineCount: 0,
            durationMs: Date.now() - started,
            lowQuality: true,
            lowQualityReason: message,
          }),
        ),
        lowQuality: true,
      });
    }

    completedCount += 1;
    await onProgress?.(completedCount, frames.length);
  }

  const members = collapseRosterMembersByNameRank(
    frameResults.flatMap((frame) =>
      frame.rows.map((row) => parsedRosterRowToExtracted(row, frame.frameIndex)),
    ),
  );

  const frameTimings: NativeRosterFrameTiming[] = frameResults.map((frame) => ({
    frameIndex: frame.frameIndex,
    ms: frame.ms,
    entryCount: frame.rows.length,
    error: frame.error,
    rawResult: frame.rawResult,
  }));

  const lowQuality =
    members.length === 0 ||
    frameResults.filter((f) => f.lowQuality).length >
      Math.max(1, Math.floor(frameResults.length * 0.5));

  const errorFrames = frameTimings.filter((frame) => frame.error);
  if (members.length === 0 || errorFrames.length > 0 || lowQuality) {
    logPipelineStep("tesseract.roster_batch_summary", 0, {
      jobId: options?.jobId,
      rowCount: members.length,
      errorFrameCount: errorFrames.length,
      lowQuality,
      errors: errorFrames.map((frame) => ({
        frameIndex: frame.frameIndex,
        error: frame.error,
      })),
      frameMs: frameTimings.map((frame) => frame.ms),
      entryCounts: frameTimings.map((frame) => frame.entryCount),
    });
  }

  return { members, frameTimings, concurrency, lowQuality };
}
