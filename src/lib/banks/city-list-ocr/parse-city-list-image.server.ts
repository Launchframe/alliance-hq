import "server-only";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import {
  parseCityListText,
  type ParsedCityListSnapshot,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";
import { preprocessCityListImage } from "@/lib/banks/city-list-ocr/preprocess-city-list-image.server";

export const BANK_CITY_LIST_SCORE_TARGET = "bank-city-list" as const;

/** Tile text is often low-confidence on dark cards; keep more lines than roster. */
export const CITY_LIST_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  tesseractPsm: 6,
  minWordConfidence: 25,
};

export type ParseCityListImageResult = ParsedCityListSnapshot & {
  rawLines: string[];
  durationMs: number;
};

/**
 * Still-frame City List "Bank Stronghold" tab OCR: contrast-preserving
 * preprocess + Tesseract, then domain-parse the text lines.
 */
export async function parseCityListImage(
  imageBuffer: Buffer,
): Promise<ParseCityListImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } = await preprocessCityListImage(imageBuffer);
  const ocrLines = await runTesseract(processedBuffer, CITY_LIST_OCR_CONFIG);
  const rawLines = ocrLines.map((line) => line.text);
  const parsed = parseCityListText(rawLines);
  return {
    ...parsed,
    rawLines,
    durationMs: Date.now() - t0,
  };
}
