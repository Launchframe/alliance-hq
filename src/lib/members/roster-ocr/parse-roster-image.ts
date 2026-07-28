/**
 * Orchestrator: preprocess → tesseract → crop → segment → parse → return result.
 *
 * This is the main entry point for the roster OCR pipeline.
 */

import { assembleMemberRowLines } from "@/lib/members/roster-ocr/assemble-member-rows.shared";
import {
  cropRosterLinesBelowSearch,
  SEARCH_FOR_MEMBERS_RE,
  toRosterOcrLineLikes,
} from "@/lib/members/roster-ocr/crop-list-region.shared";
import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { parseRosterRows } from "@/lib/members/roster-ocr/parse-rows";
import { isLowQualityRosterParse } from "@/lib/members/roster-ocr/roster-parse-quality.shared";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import type {
  AllianceRank,
  ParseRosterImageResult,
  ParsedRosterRow,
  RosterLayout,
  RosterOcrConfig,
} from "@/lib/members/roster-ocr/types";

export type ParseRosterImageOptions = {
  /** Override layout detection. */
  layout?: RosterLayout;
  /** Active config (from parse_configs experiment). */
  config?: Partial<RosterOcrConfig>;
  /** If set, stamped on the result as configPassKey. */
  configPassKey?: string;
  /** Carry rank context from a prior video frame. */
  stickyRank?: AllianceRank;
};

function scoreParseResult(rows: ParsedRosterRow[]): number {
  const withStats = rows.filter(
    (r) => r.heroPowerM != null || r.memberLevel != null,
  ).length;
  return rows.length * 10 + withStats * 5;
}

/**
 * Full roster OCR pipeline.
 *
 * 1. Pre-process (greyscale + upscale via sharp).
 * 2. Tesseract OCR → raw text lines (+ bbox when available).
 * 3. Crop to the scrollable list below "Search for Members".
 * 4. Segment by rank headers / title detection.
 * 5. Parse tokens (name, power, level) from each member line.
 */
export async function parseRosterImage(
  imageBuffer: Buffer,
  options: ParseRosterImageOptions = {},
): Promise<ParseRosterImageResult> {
  const t0 = Date.now();
  const {
    layout: explicitLayout,
    config = {},
    configPassKey,
    stickyRank,
  } = options;

  // Step 1 — pre-process
  const { buffer: processedBuffer } = await preprocessRosterImage(
    imageBuffer,
    config,
  );

  // Step 2 — OCR
  const ocrLines = await runTesseract(processedBuffer, config);
  const rawLineCount = ocrLines.length;
  const lineLikes = toRosterOcrLineLikes(ocrLines);

  // Step 3 — crop header chrome above the Search bar
  const cropped = cropRosterLinesBelowSearch(lineLikes);
  const assembledCropped = assembleMemberRowLines(cropped.lines);
  const croppedTextLines = assembledCropped.map((l) => l.text);

  const croppedParse = parseRosterRows(croppedTextLines, explicitLayout, {
    forceRankList: cropped.croppedBelowSearch,
    stickyRank,
  });

  let rows = croppedParse.rows;
  let layout = croppedParse.layout;
  let lastRank = croppedParse.lastRank;
  let usedCropFallback = false;

  // Re-parse without crop when crop yields suspiciously few member-shaped rows.
  const croppedQuality = isLowQualityRosterParse(rows);
  if (cropped.croppedBelowSearch && croppedQuality.lowQuality) {
    const assembledFull = assembleMemberRowLines(lineLikes);
    const fullTextLines = assembledFull.map((l) => l.text);
    const fullParse = parseRosterRows(fullTextLines, explicitLayout, {
      forceRankList: fullTextLines.some((l) => SEARCH_FOR_MEMBERS_RE.test(l)),
      stickyRank,
    });

    if (scoreParseResult(fullParse.rows) > scoreParseResult(rows)) {
      rows = fullParse.rows;
      layout = fullParse.layout;
      lastRank = fullParse.lastRank;
      usedCropFallback = true;
    }
  }

  const ignoredLineCount = rawLineCount - rows.length;
  const quality = isLowQualityRosterParse(rows);

  return {
    rows,
    layout,
    configPassKey,
    diagnostics: {
      rawLineCount,
      ignoredLineCount,
      durationMs: Date.now() - t0,
      searchFound: cropped.croppedBelowSearch,
      linesBeforeCrop: lineLikes.length,
      linesAfterCrop: cropped.lines.length,
      usedCropFallback,
      lastRank: lastRank ?? undefined,
      lowQuality: quality.lowQuality,
    },
    ocrRawLines: lineLikes.map((l) => l.text),
  };
}
