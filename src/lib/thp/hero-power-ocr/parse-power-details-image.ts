/**
 * Geometry-first Power Details image OCR.
 *
 * Pipeline (see plan):
 * 1. Label-band OCR (letters) → row names
 * 2. Value-band OCR (digits-only) → component numbers without comma→digit damage
 * 3. Header-value OCR (digits-only, inverted) → Hero Power total
 * 4. Zip by normalized y-center → `matchThpLabel` → assemble
 *
 * Discord/web callers still gate on `complete` (sum === header). This module does
 * not run freeform dual-pass merge or separator-digit surgery.
 */

import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import { runTesseract, type OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import {
  assembleGeometryParse,
  coalesceLabelLines,
  normalizeDigitsOnlyComponent,
  normalizeGeometryLines,
  parseDigitsOnlyHeaderTotal,
  zipLabelsToValues,
  type GeometryOcrLine,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import {
  toThpBreakdown,
  type ParsePowerDetailsResult,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import {
  POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
  POWER_DETAILS_LABEL_OCR_CONFIG,
  POWER_DETAILS_VALUE_OCR_CONFIG,
  preprocessPowerDetailsHeaderValue,
  preprocessPowerDetailsLabelBand,
  preprocessPowerDetailsValueBand,
  preprocessPowerDetailsValueBandInverted,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

export type ParsePowerDetailsImageResult = ParsePowerDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
    sampleLines: string[];
    /** How many label↔value pairs mapped to a breakdown key with a numeric value. */
    pairedCount?: number;
  };
};

function toGeometryLines(lines: OcrLineResult[]): GeometryOcrLine[] {
  return lines.map((line) => ({
    text: line.text,
    bbox: line.bbox ?? null,
  }));
}

function pickHeaderTotal(
  headerLines: OcrLineResult[],
  invertedValueLines: OcrLineResult[],
  valueLines: OcrLineResult[],
): number | null {
  return (
    pickBestHeaderCandidate(headerLines) ??
    pickBestHeaderCandidate(invertedValueLines.slice(0, 4)) ??
    pickBestHeaderCandidate(valueLines.slice(0, 3))
  );
}

function pickBestHeaderCandidate(lines: OcrLineResult[]): number | null {
  let best: number | null = null;
  for (const line of lines) {
    // Normalize separator-slot pollution first (`164,615,505` → sometimes 10 digits).
    const normalized =
      normalizeDigitsOnlyComponent(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    if (normalized == null) continue;
    // Hero Power totals dominate individual components (typically ≥100M once
    // accounts leave early game). Reject component-sized readings that appear
    // in the value column (gear / exclusive weapon / etc.).
    if (normalized < 100_000_000 || normalized > 1_000_000_000) continue;
    if (best == null || normalized > best) best = normalized;
  }
  return best;
}


export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();

  const [labelPre, valuePre, valueInvPre, headerPre] = await Promise.all([
    preprocessPowerDetailsLabelBand(imageBuffer),
    preprocessPowerDetailsValueBand(imageBuffer),
    preprocessPowerDetailsValueBandInverted(imageBuffer),
    preprocessPowerDetailsHeaderValue(imageBuffer),
  ]);

  // Tesseract worker is serialized internally — await sequentially for clarity.
  const labelLinesRaw = await runTesseract(
    labelPre.buffer,
    POWER_DETAILS_LABEL_OCR_CONFIG,
  );
  const valueLinesRaw = await runTesseract(
    valuePre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  const valueInvLinesRaw = await runTesseract(
    valueInvPre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  const headerLinesRaw = await runTesseract(
    headerPre.buffer,
    POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
  );

  const labels = coalesceLabelLines(
    normalizeGeometryLines(toGeometryLines(labelLinesRaw), labelPre.height),
  );
  // Inverted value column recovers white outlined digits better on this UI.
  // Fall back to the non-inverted pass when inverted yields fewer digit lines.
  const invertedValues = normalizeGeometryLines(
    toGeometryLines(valueInvLinesRaw),
    valueInvPre.height,
  );
  const normalValues = normalizeGeometryLines(
    toGeometryLines(valueLinesRaw),
    valuePre.height,
  );
  const valuesRaw =
    invertedValues.filter((line) => /\d{5,}/.test(line.text)).length >=
    normalValues.filter((line) => /\d{5,}/.test(line.text)).length
      ? invertedValues
      : normalValues;

  const headerTotal = pickHeaderTotal(
    headerLinesRaw,
    valueInvLinesRaw,
    valueLinesRaw,
  );

  // The value column still contains the header-row total on the right. Drop it
  // so it cannot be y-zipped onto Hero Level (same failure mode as freeform
  // attaching the total to the wrong row).
  const values = valuesRaw.filter((line) => {
    const asHeader = parseDigitsOnlyHeaderTotal(line.text);
    if (headerTotal != null && asHeader === headerTotal) return false;
    if (line.yNorm < 0.12 && asHeader != null) return false;
    return true;
  });

  const pairs = zipLabelsToValues({ labels, values });
  const assembled = assembleGeometryParse({ pairs, headerTotal });

  const sampleLines = [
    ...headerLinesRaw.map((line) => `hdr:${line.text}`),
    ...valueInvLinesRaw.slice(0, 3).map((line) => `inv:${line.text}`),
    ...pairs.map(
      (pair) =>
        `${pair.key ?? "?"}=${pair.valueText} ← ${pair.label.slice(0, 40)}`,
    ),
    ...valueLinesRaw.slice(0, 4).map((line) => `val:${line.text}`),
  ];

  const durationMs = Date.now() - t0;
  const diagnostics = buildOcrDiagnostics({
    source: "thp_screenshot",
    durationMs,
    rawLineCount:
      labelLinesRaw.length +
      valueLinesRaw.length +
      valueInvLinesRaw.length +
      headerLinesRaw.length,
    lines: sampleLines,
    parsedOk: assembled.complete && assembled.heroPowerTotal != null,
    parsedValue: assembled.heroPowerTotal,
    entryCount: assembled.pairedCount,
  });
  logOcrDiagnostics(diagnostics);

  return {
    heroPowerTotal: assembled.heroPowerTotal,
    breakdown: assembled.breakdown,
    complete: assembled.complete,
    diagnostics: {
      rawLineCount: diagnostics.rawLineCount,
      durationMs: diagnostics.durationMs,
      sampleLines: diagnostics.sampleLines,
      pairedCount: assembled.pairedCount,
    },
  };
}

export { toThpBreakdown };
