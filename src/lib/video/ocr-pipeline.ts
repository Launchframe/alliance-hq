import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44ExtractData,
  base44UploadFile,
} from "@/lib/base44/fetch";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import {
  extractEntries,
  mergeOcrResults,
  type OcrEntry,
} from "@/lib/video/normalize-rows";

export type OcrFrameTiming = {
  frameIndex: number;
  ms: number;
  entryCount: number;
};

export async function ocrFrameBuffer(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  buffer: Buffer,
  frameIndex: number,
): Promise<OcrEntry[]> {
  const fileName = `frame_${String(frameIndex).padStart(4, "0")}.jpg`;
  const { file_url } = await base44UploadFile(
    connection,
    fileName,
    "image/jpeg",
    buffer,
  );
  const result = await base44ExtractData(
    connection,
    file_url,
    target.ocrSchema,
  );
  return extractEntries(result);
}

export async function ocrAllFrames(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  frames: Array<{ index: number; buffer: Buffer }>,
): Promise<{ entries: OcrEntry[]; frameTimings: OcrFrameTiming[] }> {
  const batches: OcrEntry[][] = [];
  const frameTimings: OcrFrameTiming[] = [];

  for (const frame of frames) {
    const frameStarted = Date.now();
    const entries = await ocrFrameBuffer(
      connection,
      target,
      frame.buffer,
      frame.index,
    );
    frameTimings.push({
      frameIndex: frame.index,
      ms: Date.now() - frameStarted,
      entryCount: entries.length,
    });
    if (entries.length > 0) {
      batches.push(entries);
    }
  }

  return {
    entries: mergeOcrResults(batches),
    frameTimings,
  };
}
