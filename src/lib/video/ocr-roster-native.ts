import "server-only";

import { parseRosterImage } from "@/lib/members/roster-ocr/parse-roster-image";
import type { ParsedRosterRow, RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
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
};

export type OcrRosterNativeFramesResult = {
  members: ExtractedRosterMember[];
  frameTimings: NativeRosterFrameTiming[];
  concurrency: number;
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
  },
): Promise<OcrRosterNativeFramesResult> {
  const config = options?.config ?? DEFAULT_ROSTER_OCR_CONFIG;
  const passKey = options?.passKey ?? null;
  const concurrency = Math.min(
    options?.concurrency ?? TESSERACT_FRAME_CONCURRENCY,
    NATIVE_ROSTER_TESSERACT_CONCURRENCY,
  );
  const timer = options?.timer;

  timer?.logStep("tesseract.roster_batch_start", 0, {
    jobId: options?.jobId,
    frameCount: frames.length,
    concurrency,
  });

  const frameResults = await mapWithConcurrency(
    frames,
    concurrency,
    async (frame) => {
      const started = Date.now();
      try {
        const result = await parseRosterImage(frame.buffer, {
          config,
          configPassKey: passKey ?? undefined,
        });
        const ms = Date.now() - started;
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
        return {
          frameIndex: frame.index,
          ms,
          rows: result.rows,
          error: null as string | null,
        };
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
        return {
          frameIndex: frame.index,
          ms: Date.now() - started,
          rows: [] as ParsedRosterRow[],
          error: message,
        };
      }
    },
  );

  const members = collapseRosterMembersByNameRank(
    frameResults.flatMap((frame) =>
      frame.rows.map((row) => parsedRosterRowToExtracted(row, frame.frameIndex)),
    ),
  );

  const frameTimings: NativeRosterFrameTiming[] = frameResults
    .sort((a, b) => a.frameIndex - b.frameIndex)
    .map((frame) => ({
      frameIndex: frame.frameIndex,
      ms: frame.ms,
      entryCount: frame.rows.length,
      error: frame.error,
    }));

  const errorFrames = frameTimings.filter((frame) => frame.error);
  if (members.length === 0 || errorFrames.length > 0) {
    logPipelineStep("tesseract.roster_batch_summary", 0, {
      jobId: options?.jobId,
      rowCount: members.length,
      errorFrameCount: errorFrames.length,
      errors: errorFrames.map((frame) => ({
        frameIndex: frame.frameIndex,
        error: frame.error,
      })),
      frameMs: frameTimings.map((frame) => frame.ms),
      entryCounts: frameTimings.map((frame) => frame.entryCount),
    });
  }

  return { members, frameTimings, concurrency };
}
