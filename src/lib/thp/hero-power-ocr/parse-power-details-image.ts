import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import {
  parsePowerDetailsLines,
  toThpBreakdown,
  type ParsePowerDetailsResult,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import {
  POWER_DETAILS_OCR_CONFIG,
  preprocessPowerDetailsImage,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

export type ParsePowerDetailsImageResult = ParsePowerDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
    sampleLines: string[];
  };
};

export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();
  const { buffer: processedBuffer } =
    await preprocessPowerDetailsImage(imageBuffer);
  const ocrLines = await runTesseract(
    processedBuffer,
    POWER_DETAILS_OCR_CONFIG,
  );
  const textLines = ocrLines.map((line) => line.text);
  const parsed = parsePowerDetailsLines(textLines);
  const durationMs = Date.now() - t0;
  const diagnostics = buildOcrDiagnostics({
    source: "thp_screenshot",
    durationMs,
    rawLineCount: textLines.length,
    lines: textLines,
    parsedOk: parsed.heroPowerTotal != null,
    parsedValue: parsed.heroPowerTotal,
  });
  logOcrDiagnostics(diagnostics);
  return {
    ...parsed,
    breakdown: parsed.breakdown,
    diagnostics: {
      rawLineCount: diagnostics.rawLineCount,
      durationMs: diagnostics.durationMs,
      sampleLines: diagnostics.sampleLines,
    },
  };
}

export { toThpBreakdown };
