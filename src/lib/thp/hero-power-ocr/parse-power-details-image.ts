import { preprocessRosterImage } from "@/lib/members/roster-ocr/preprocess";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import {
  parsePowerDetailsLines,
  toThpBreakdown,
  type ParsePowerDetailsResult,
} from "@/lib/thp/hero-power-ocr/parse-power-details";

export type ParsePowerDetailsImageResult = ParsePowerDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
  };
};

export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } = await preprocessRosterImage(imageBuffer);
  const ocrLines = await runTesseract(processedBuffer);
  const textLines = ocrLines.map((line) => line.text);
  const parsed = parsePowerDetailsLines(textLines);
  return {
    ...parsed,
    breakdown: parsed.breakdown,
    diagnostics: {
      rawLineCount: textLines.length,
      durationMs: Date.now() - t0,
    },
  };
}

export { toThpBreakdown };
