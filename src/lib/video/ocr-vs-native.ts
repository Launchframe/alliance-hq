import "server-only";

import sharp from "sharp";

import { runTesseract, type OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import type { OcrAllFramesResult } from "@/lib/video/ocr-pipeline";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";

export function parseVsScoreLines(lines: readonly OcrLineResult[]): OcrEntry[] {
  const groups: OcrLineResult[][] = [];
  for (const line of lines) {
    const box = line.bbox;
    const group = box && groups.find((group) => {
      const other = group[0].bbox;
      if (!other) return false;
      const overlap = Math.min(box.y1, other.y1) - Math.max(box.y0, other.y0);
      return overlap > 0 && overlap >= Math.min(box.y1 - box.y0, other.y1 - other.y0) * 0.5;
    });
    if (group) group.push(line);
    else groups.push([line]);
  }

  const entries: OcrEntry[] = [];
  for (const group of groups) {
    const text = group
      .sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0))
      .map((line) => line.text.trim())
      .join(" ")
      .replace(/\s+/g, " ");
    const match = text.match(/^(?:(\d{1,3})[.)]?\s+)?(.+?)\s+(\d{1,3}(?:[, .]\d{3})+|\d+)$/u);
    if (!match) continue;
    const rank = match[1] ? Number(match[1]) : undefined;
    const name = match[2].trim();
    const score = match[3].replace(/[, .]/g, "");
    if (
      (rank != null && (rank < 1 || rank > 200)) ||
      !/[\p{L}]/u.test(name) ||
      /^(?:(?:weekly|daily|alliance|my|your|total)\s+(?:total|points|score)|pontua[çc][aã]o|pontos|total)\b/iu.test(name) ||
      (rank == null && score.length < 4) ||
      !Number.isSafeInteger(Number(score))
    ) continue;
    entries.push({ ...(rank == null ? {} : { rank }), name, score });
  }
  return entries;
}

export async function ocrVsNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: { onProgress?: VideoOcrProgressCallback },
): Promise<OcrAllFramesResult> {
  const entries: OcrEntry[] = [];
  const frameTimings: OcrAllFramesResult["frameTimings"] = [];
  for (const [offset, frame] of frames.entries()) {
    const started = Date.now();
    const image = await sharp(frame.buffer)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .png()
      .toBuffer();
    const lines = await runTesseract(image, { tesseractPsm: 6, minWordConfidence: 0 });
    const parsed = parseVsScoreLines(lines).map((entry) => ({
      ...entry,
      _sourceFrameIndex: frame.index,
    }));
    entries.push(...parsed);
    const ms = Date.now() - started;
    frameTimings.push({
      frameIndex: frame.index,
      ms,
      uploadMs: 0,
      extractMs: ms,
      entryCount: parsed.length,
      error: null,
      rawResult: { entries: parsed },
    });
    await options?.onProgress?.(offset + 1, frames.length);
  }
  return { entries, observations: entries, frameTimings, concurrency: 1 };
}
