import "server-only";

import { mergeCityListOcrPasses } from "@/lib/banks/city-list-ocr/city-list-dedupe.shared";
import {
  parseCityListText,
  type ParsedCityListSnapshot,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import {
  preprocessCityListGreenChannel,
  preprocessCityListImage,
} from "@/lib/banks/city-list-ocr/preprocess-city-list-image.server";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";

export const BANK_CITY_LIST_SCORE_TARGET = "bank-city-list" as const;

/**
 * Tile text is often low-confidence on dark cards / peach overlays; keep weak
 * coord and Lv tokens (THP-style) rather than dropping whole rows.
 */
export const CITY_LIST_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  tesseractPsm: 6,
  minWordConfidence: 0,
};

export type ParseCityListImageResult = ParsedCityListSnapshot & {
  rawLines: string[];
  durationMs: number;
};

async function ocrLinesFromBuffer(buffer: Buffer): Promise<string[]> {
  const ocrLines = await runTesseract(buffer, CITY_LIST_OCR_CONFIG);
  return ocrLines.map((line) => line.text);
}

/**
 * Still-frame City List "Bank Stronghold" tab OCR: soft greyscale + green
 * emphasis passes (sequential — tesseract worker is not concurrent-safe), then
 * proximity-merge so a pass that only recovers one grid row still contributes
 * tiles without spawning ±1 coordinate duplicates.
 */
export async function parseCityListImage(
  imageBuffer: Buffer,
): Promise<ParseCityListImageResult> {
  const t0 = Date.now();

  const primaryPre = await preprocessCityListImage(imageBuffer);
  const primaryLines = await ocrLinesFromBuffer(primaryPre.buffer);
  const primaryParsed = parseCityListText(primaryLines);

  const greenPre = await preprocessCityListGreenChannel(imageBuffer);
  const greenLines = await ocrLinesFromBuffer(greenPre.buffer);
  const greenParsed = parseCityListText(greenLines);

  const snapshot = mergeCityListOcrPasses(primaryParsed, greenParsed);
  const rawLines = [
    ...primaryLines,
    ...(greenLines.length > 0 ? ["--- green-pass ---", ...greenLines] : []),
  ];

  return {
    ...snapshot,
    rawLines,
    durationMs: Date.now() - t0,
  };
}
