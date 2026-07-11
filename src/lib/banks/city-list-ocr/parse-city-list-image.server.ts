import "server-only";

import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import {
  parseCityListText,
  type ParsedCityListSnapshot,
} from "@/lib/banks/city-list-ocr/parse-city-list-text.shared";

export const BANK_CITY_LIST_SCORE_TARGET = "bank-city-list" as const;

export type ParseCityListImageResult = ParsedCityListSnapshot & {
  rawLines: string[];
  durationMs: number;
};

/**
 * Still-frame City List "Bank Stronghold" tab OCR: reuse roster preprocess +
 * Tesseract, then domain-parse the text lines.
 */
export async function parseCityListImage(
  imageBuffer: Buffer,
): Promise<ParseCityListImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } = await preprocessRosterImage(
    imageBuffer,
    DEFAULT_ROSTER_OCR_CONFIG,
  );
  const ocrLines = await runTesseract(
    processedBuffer,
    DEFAULT_ROSTER_OCR_CONFIG,
  );
  const rawLines = ocrLines.map((line) => line.text);
  const parsed = parseCityListText(rawLines);
  return {
    ...parsed,
    rawLines,
    durationMs: Date.now() - t0,
  };
}
