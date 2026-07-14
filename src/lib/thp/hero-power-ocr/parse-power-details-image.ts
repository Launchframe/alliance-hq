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
  POWER_DETAILS_BODY_OCR_CONFIG,
  POWER_DETAILS_HEADER_OCR_CONFIG,
  preprocessPowerDetailsHeaderBand,
  preprocessPowerDetailsImage,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

export type ParsePowerDetailsImageResult = ParsePowerDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
    sampleLines: string[];
  };
};

function mergeOcrLines(primary: string[], secondary: string[]): string[] {
  const out = [...primary];
  const seen = new Set(primary.map((line) => line.toLowerCase()));
  for (const line of secondary) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function parseScore(parsed: ParsePowerDetailsResult): number {
  let score = 0;
  if (parsed.heroPowerTotal != null) score += 100;
  if (parsed.complete) score += 50;
  score += Object.keys(parsed.breakdown).length * 5;
  return score;
}

export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();

  // Body first (component rows), then inverted header band (Hero Power total).
  // Sequential: shared Tesseract worker is serialized anyway.
  const bodyPre = await preprocessPowerDetailsImage(imageBuffer);
  const bodyLines = (
    await runTesseract(bodyPre.buffer, POWER_DETAILS_BODY_OCR_CONFIG)
  ).map((line) => line.text);

  const headerPre = await preprocessPowerDetailsHeaderBand(imageBuffer);
  const headerLines = (
    await runTesseract(headerPre.buffer, POWER_DETAILS_HEADER_OCR_CONFIG)
  ).map((line) => line.text);

  const mergedLines = mergeOcrLines(headerLines, bodyLines);
  const bodyOnly = parsePowerDetailsLines(bodyLines);
  const merged = parsePowerDetailsLines(mergedLines);
  const parsed = parseScore(merged) >= parseScore(bodyOnly) ? merged : bodyOnly;
  const textLines =
    parseScore(merged) >= parseScore(bodyOnly) ? mergedLines : bodyLines;

  const durationMs = Date.now() - t0;
  const diagnostics = buildOcrDiagnostics({
    source: "thp_screenshot",
    durationMs,
    rawLineCount: textLines.length,
    lines: textLines,
    parsedOk: parsed.complete && parsed.heroPowerTotal != null,
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
