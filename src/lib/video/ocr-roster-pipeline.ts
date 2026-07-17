import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44ExtractData,
  base44UploadFile,
} from "@/lib/base44/fetch";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";
import type { PipelineTimer } from "@/lib/video/pipeline-timer";
import { defaultAshFrameConcurrency } from "@/lib/video/ocr-pipeline";
import {
  collapseRosterMembersByNameRank,
  extractRosterMembers,
  rosterOcrMemberToExtracted,
  type ExtractedRosterMember,
} from "@/lib/video/roster-extract";

export type RosterOcrFrameTiming = {
  frameIndex: number;
  ms: number;
  uploadMs: number;
  extractMs: number;
  entryCount: number;
  error: string | null;
  rawResult: unknown;
};

export type OcrRosterAllFramesResult = {
  members: ExtractedRosterMember[];
  frameTimings: RosterOcrFrameTiming[];
  concurrency: number;
  rawPayloads: unknown[];
};

function rosterFrameFileName(frameIndex: number): string {
  return "frame_" + String(frameIndex).padStart(4, "0") + ".jpg";
}

export async function ocrRosterAllFrames(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: {
    concurrency?: number;
    timer?: PipelineTimer;
    jobId?: string;
    onProgress?: VideoOcrProgressCallback;
  },
): Promise<OcrRosterAllFramesResult> {
  const concurrency = options?.concurrency ?? defaultAshFrameConcurrency();
  const timer = options?.timer;
  const jobId = options?.jobId;
  const onProgress = options?.onProgress;
  let completedCount = 0;

  timer?.logStep("ashed.roster_batch_start", 0, {
    jobId,
    frameCount: frames.length,
    concurrency,
  });

  const frameResults = await mapWithConcurrency(
    frames,
    concurrency,
    async (frame) => {
      const frameStarted = Date.now();
      const fileName = rosterFrameFileName(frame.index);

      const result = await (async () => {
        try {
          const uploadStarted = Date.now();
          const { file_url } = await base44UploadFile(
            connection,
            fileName,
            "image/jpeg",
            frame.buffer,
          );
          const uploadMs = Date.now() - uploadStarted;

          const extractStarted = Date.now();
          const rawResult = await base44ExtractData(
            connection,
            file_url,
            target.ocrSchema,
          );
          const extractMs = Date.now() - extractStarted;

          const ocrMembers = extractRosterMembers(rawResult);
          const members = ocrMembers.map((m) =>
            rosterOcrMemberToExtracted(m, frame.index),
          );

          return {
            frameIndex: frame.index,
            members,
            ms: Date.now() - frameStarted,
            uploadMs,
            extractMs,
            rawResult,
            error: null as string | null,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Roster OCR frame failed";
          return {
            frameIndex: frame.index,
            members: [] as ExtractedRosterMember[],
            ms: Date.now() - frameStarted,
            uploadMs: 0,
            extractMs: 0,
            rawResult: null,
            error: message,
          };
        }
      })();

      completedCount += 1;
      await onProgress?.(completedCount, frames.length);

      return result;
    },
  );

  const sortedResults = frameResults.sort((a, b) => a.frameIndex - b.frameIndex);
  const allMembers = sortedResults.flatMap((r) => r.members);
  const collapsed = collapseRosterMembersByNameRank(allMembers);

  const frameTimings: RosterOcrFrameTiming[] = sortedResults.map((result) => ({
    frameIndex: result.frameIndex,
    ms: result.ms,
    uploadMs: result.uploadMs,
    extractMs: result.extractMs,
    entryCount: result.members.length,
    error: result.error,
    rawResult: result.rawResult,
  }));

  return {
    members: collapsed,
    frameTimings,
    concurrency,
    rawPayloads: sortedResults
      .map((r) => r.rawResult)
      .filter((r): r is unknown => r != null),
  };
}
