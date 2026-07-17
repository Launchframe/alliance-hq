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

function isUsefulHeaderLine(line: string): boolean {
  return (
    /hero\s*l?\s*powers?/i.test(line) ||
    /power\s*details/i.test(line) ||
    /helden\s*kampf\s*kraft/i.test(line) ||
    /kampf\s*kraft/i.test(line) ||
    /details\s*der\s*kampf/i.test(line) ||
    /poder\s*do\s*her[oó]i/i.test(line) ||
    /detalhes\s*do\s*poder/i.test(line) ||
    /영웅\s*전투력/.test(line) ||
    /전투력\s*정보/.test(line)
  );
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

  // Body first (component rows). Only fall back to the inverted header-band
  // pass (extra Tesseract call) when the body alone didn't already produce a
  // header-reconciled result — keeps the common case single-pass.
  const bodyPre = await preprocessPowerDetailsImage(imageBuffer);
  const bodyLines = (
    await runTesseract(bodyPre.buffer, POWER_DETAILS_BODY_OCR_CONFIG)
  ).map((line) => line.text);
  const bodyOnly = parsePowerDetailsLines(bodyLines);

  let parsed: ParsePowerDetailsResult = bodyOnly;
  let textLines = bodyLines;

  if (!bodyOnly.complete || bodyOnly.heroPowerTotal == null) {
    const headerPre = await preprocessPowerDetailsHeaderBand(imageBuffer);
    const headerLines = (
      await runTesseract(headerPre.buffer, POWER_DETAILS_HEADER_OCR_CONFIG)
    )
      .map((line) => line.text)
      .filter(isUsefulHeaderLine);

    const mergedLines = mergeOcrLines(headerLines, bodyLines);
    const merged = parsePowerDetailsLines(mergedLines);
    if (parseScore(merged) >= parseScore(bodyOnly)) {
      parsed = merged;
      textLines = mergedLines;
    }
  }

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
