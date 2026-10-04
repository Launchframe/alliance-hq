import "server-only";

import sharp from "sharp";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import type { OcrAllFramesResult } from "@/lib/video/ocr-pipeline";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";
import type { OcrEntry } from "@/lib/video/normalize-rows";

/**
 * Conservative native name+score adapter for Storm (Desert/Canyon) and
 * seasonal/custom event screenshots and videos. These targets demonstrate a
 * simple two-column "name … score" table; anything with less structure than
 * two clean rows returns zero entries so the caller flags the parse as
 * review-required / unsupportedLayout instead of guessing.
 */

type OcrLine = { text: string };

const HEADER_OR_CHROME =
  /\b(ranking|rank|commander|points|score|event|alliance|members?|total|day|stage|power|lv\.?|level)\b/iu;
const MIN_TABLE_ROWS = 2;
const MAX_SCORE_DIGITS = 12;

type ParsedScoreRow = {
  name: string;
  score: string;
  rank?: number;
};

/** Canonical integer string from a candidate OCR score token, or null. */
export function normalizeEventScoreToken(token: string): string | null {
  const digits = token.replace(/[,.\s\u00a0]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length > MAX_SCORE_DIGITS) return null;
  try {
    return BigInt(digits).toString();
  } catch {
    return null;
  }
}

/**
 * Parse OCR text lines into name+score rows. A row qualifies when a line
 * ends in a numeric score token and has a plausible name before it. Power,
 * level, and badge chrome is rejected — those numbers are never scores.
 */
export function parseEventScoreLines(
  lines: readonly OcrLine[],
): ParsedScoreRow[] {
  const rows: ParsedScoreRow[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length < 3) continue;
    if (HEADER_OR_CHROME.test(text)) continue;

    const match = text.match(/^(.*?)[\s:：\-–—|]*(\d[\d,.\s\u00a0]*\d|\d)\s*$/u);
    if (!match) continue;
    const name = match[1]!.trim().replace(/^[#\d]+[.)]?\s*/, "");
    const score = normalizeEventScoreToken(match[2]!);
    if (score == null) continue;
    if (name.length < 2 || /^[\W_\d]+$/.test(name)) continue;
    if (/\bpower\b|\blv\.?|\bR[1-5]\b/iu.test(name)) continue;
    rows.push({ name, score });
  }
  return rows;
}

/**
 * True when the frame yielded enough consistent structure to be a
 * name+score table. Below the threshold the parse is review-required.
 */
export function hasEventScoreTableStructure(rows: readonly ParsedScoreRow[]): boolean {
  return rows.length >= MIN_TABLE_ROWS;
}

export type EventScoreNativeResult = OcrAllFramesResult & {
  /** Per-frame structural sufficiency — false ⇒ review-required frame. */
  insufficientStructure: boolean;
};

export async function parseEventScoreImage(buffer: Buffer): Promise<{
  rows: ParsedScoreRow[];
  sufficient: boolean;
}> {
  const { data: image } = await sharp(buffer)
    .rotate()
    .flatten({ background: "white" })
    .removeAlpha()
    .resize({ width: 1260 })
    .grayscale()
    .normalize()
    .png()
    .toBuffer({ resolveWithObject: true });
  const lines = await runTesseract(image, {
    tesseractPsm: 11,
    minWordConfidence: 0,
  });
  const rows = parseEventScoreLines(lines);
  return { rows, sufficient: hasEventScoreTableStructure(rows) };
}

export async function ocrEventScoreNativeFrames(
  frames: Array<{ index: number; buffer: Buffer }>,
  options?: { onProgress?: VideoOcrProgressCallback },
): Promise<EventScoreNativeResult> {
  const entries: OcrEntry[] = [];
  const frameTimings: OcrAllFramesResult["frameTimings"] = [];
  let insufficientStructure = false;
  for (const [offset, frame] of frames.entries()) {
    const start = Date.now();
    let observed: OcrEntry[] = [];
    let error: string | null = null;
    let rawResult: unknown = null;
    try {
      const result = await parseEventScoreImage(frame.buffer);
      rawResult = result;
      if (!result.sufficient) insufficientStructure = true;
      observed = result.rows.map((row, rowIndex) => ({
        name: row.name,
        score: row.score,
        rank: row.rank ?? rowIndex + 1,
        _sourceFrameIndex: frame.index,
      }));
    } catch (err) {
      insufficientStructure = true;
      error = err instanceof Error ? err.message : String(err);
    }
    entries.push(...observed);
    const ms = Date.now() - start;
    frameTimings.push({
      frameIndex: frame.index,
      ms,
      uploadMs: 0,
      extractMs: ms,
      entryCount: observed.length,
      error,
      rawResult,
    });
    await options?.onProgress?.(offset + 1, frames.length);
  }
  return {
    entries,
    observations: entries,
    frameTimings,
    concurrency: 1,
    insufficientStructure,
  };
}
