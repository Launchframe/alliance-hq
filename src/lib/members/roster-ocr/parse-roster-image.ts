/**
 * Orchestrator: preprocess → tesseract → segment → parse → return result.
 *
 * This is the main entry point for the roster OCR pipeline.
 */

import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { parseRosterRows } from "@/lib/members/roster-ocr/parse-rows";
import type {
  ParseRosterImageResult,
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
};

/**
 * Full roster OCR pipeline.
 *
 * 1. Pre-process (greyscale + upscale via sharp).
 * 2. Tesseract OCR → raw text lines.
 * 3. Segment by rank headers / title detection.
 * 4. Parse tokens (name, power, level) from each member line.
 */
export async function parseRosterImage(
  imageBuffer: Buffer,
  options: ParseRosterImageOptions = {},
): Promise<ParseRosterImageResult> {
  const t0 = Date.now();
  const { layout: explicitLayout, config = {}, configPassKey } = options;

  // Step 1 — pre-process
  const { buffer: processedBuffer } = await preprocessRosterImage(
    imageBuffer,
    config,
  );

  // Step 2 — OCR
  const ocrLines = await runTesseract(processedBuffer, config);

  const rawLineCount = ocrLines.length;
  const textLines = ocrLines.map((l) => l.text);

  // Step 3 + 4 — segment + parse
  const { rows, layout } = parseRosterRows(textLines, explicitLayout);

  const ignoredLineCount = rawLineCount - rows.length;

  return {
    rows,
    layout,
    configPassKey,
    diagnostics: {
      rawLineCount,
      ignoredLineCount,
      durationMs: Date.now() - t0,
    },
  };
}
