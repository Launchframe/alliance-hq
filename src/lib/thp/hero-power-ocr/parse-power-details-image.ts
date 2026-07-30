/**
 * Geometry-first Power Details image OCR.
 *
 * Pipeline:
 * 1. Modal detect + label-band probe scoring
 * 2. Label-band OCR (letters) → row names
 * 3. Value-band OCR (digits-only) → component numbers without comma→digit damage
 * 4. Header-value OCR (digits-only, inverted) → Hero Power total
 * 5. Zip by normalized y-center → `matchThpLabel` → assemble
 *
 * Discord/web callers still gate on `complete` (sum === header).
 */

import {
  buildOcrDiagnostics,
  logOcrDiagnostics,
} from "@/lib/ocr/ocr-diagnostics.shared";
import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";
import {
  computeThpScreenshotQuality,
  type CropCandidateScore,
  type ScreenshotOcrQualityMetrics,
} from "@/lib/ocr/screenshot-ocr-quality.shared";
import type { ScreenshotOcrBboxOverlay } from "@/lib/ocr/screenshot-ocr-geometry.shared";
import { runTesseract, type OcrLineResult } from "@/lib/members/roster-ocr/tesseract";
import { resolvePowerDetailsModal } from "@/lib/thp/hero-power-ocr/detect-power-details-modal";
import {
  assembleGeometryParse,
  buildThpBboxOverlays,
  coalesceLabelLines,
  normalizeDigitsOnlyComponent,
  normalizeGeometryLines,
  parseDigitsOnlyHeaderTotal,
  parseDigitsOnlyHeaderTotalLoose,
  pickHeroPowerHeaderFromLabelRow,
  reconcileHeroPowerHeaderTotal,
  zipLabelsToValues,
  type GeometryOcrLine,
  type LabelValuePair,
  type NormalizedGeometryLine,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import {
  toThpBreakdown,
  type ParsePowerDetailsResult,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import {
  getPowerDetailsBandCrops,
  POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
  POWER_DETAILS_LABEL_OCR_CONFIG,
  POWER_DETAILS_VALUE_OCR_CONFIG,
  preprocessPowerDetailsHeaderValue,
  preprocessPowerDetailsLabelBand,
  preprocessPowerDetailsValueBand,
  preprocessPowerDetailsValueBandInverted,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

export type ParsePowerDetailsImageOptions = {
  jobId?: string;
};

export type ParsePowerDetailsImageResult = ParsePowerDetailsResult & {
  diagnostics: {
    rawLineCount: number;
    durationMs: number;
    sampleLines: string[];
    /** How many label↔value pairs mapped to a breakdown key with a numeric value. */
    pairedCount?: number;
    modalRect?: CropRect;
    modalMethod?: string;
    quality?: ScreenshotOcrQualityMetrics;
    bboxOverlays?: ScreenshotOcrBboxOverlay[];
    bandCrops?: ReturnType<typeof getPowerDetailsBandCrops>;
    cropCandidates?: CropCandidateScore[];
    phaseTimings?: ScreenshotOcrQualityMetrics["phaseTimings"];
  };
};

function toGeometryLines(lines: OcrLineResult[]): GeometryOcrLine[] {
  return lines.map((line) => ({
    text: line.text,
    bbox: line.bbox ?? null,
  }));
}

function lineYNorm(line: OcrLineResult, cropHeight: number): number | null {
  const box = line.bbox;
  if (!box || !Number.isFinite(box.y0) || !Number.isFinite(box.y1)) {
    return null;
  }
  return (box.y0 + box.y1) / 2 / Math.max(1, cropHeight);
}

function pickHeaderTotal(
  headerLines: OcrLineResult[],
  headerCropHeight: number,
  invertedValueLines: OcrLineResult[],
  invertedCropHeight: number,
  valueLines: OcrLineResult[],
  valueCropHeight: number,
): number | null {
  return (
    pickBestHeaderCandidate(headerLines, headerCropHeight) ??
    pickBestHeaderCandidate(invertedValueLines.slice(0, 6), invertedCropHeight) ??
    pickBestHeaderCandidate(valueLines.slice(0, 4), valueCropHeight)
  );
}

function pickBestHeaderCandidate(
  lines: OcrLineResult[],
  cropHeight: number,
): number | null {
  const candidates: Array<{ yNorm: number; value: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const digitLen = line.text.replace(/\D/g, "").length;
    let normalized =
      parseDigitsOnlyHeaderTotalLoose(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    if (normalized == null && digitLen > 9) {
      normalized = normalizeDigitsOnlyComponent(line.text);
    }
    if (normalized == null) continue;
    if (normalized < 100_000_000 || normalized > 1_000_000_000) continue;

    const yNorm =
      lineYNorm(line, cropHeight) ??
      (lines.length > 1 ? index / (lines.length - 1) : 0);
    candidates.push({ yNorm, value: normalized });
  }

  candidates.sort((a, b) => a.yNorm - b.yNorm);
  return candidates[0]?.value ?? null;
}

function findHeaderLine(
  headerTotal: number | null,
  headerLines: OcrLineResult[],
  valueInvLines: OcrLineResult[],
  valueLines: OcrLineResult[],
): GeometryOcrLine | null {
  if (headerTotal == null) return null;

  const allLines = [...headerLines, ...valueInvLines.slice(0, 6), ...valueLines.slice(0, 4)];
  for (const line of allLines) {
    const parsed =
      parseDigitsOnlyHeaderTotalLoose(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    if (parsed === headerTotal) {
      return { text: line.text, bbox: line.bbox ?? null };
    }
  }
  return null;
}

function collectUnmatchedValues(
  values: NormalizedGeometryLine[],
  pairs: LabelValuePair[],
): NormalizedGeometryLine[] {
  const used = new Set(
    pairs
      .map((pair) => pair.valueText)
      .filter((text) => text.length > 0),
  );
  return values.filter((line) => !used.has(line.text));
}

export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
  options: ParsePowerDetailsImageOptions = {},
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();
  const phaseTimings: ScreenshotOcrQualityMetrics["phaseTimings"] = {
    preprocessMs: 0,
    modalDetectMs: 0,
    labelOcrMs: 0,
    valueOcrMs: 0,
    headerOcrMs: 0,
    zipMs: 0,
    totalMs: 0,
  };

  const modalT0 = Date.now();
  const modalResolution = await resolvePowerDetailsModal(imageBuffer);
  phaseTimings.modalDetectMs = Date.now() - modalT0;
  const modal = modalResolution.modal;
  const bandCrops = getPowerDetailsBandCrops(modal);

  const preprocessT0 = Date.now();
  const [labelPre, valuePre, valueInvPre, headerPre] = await Promise.all([
    preprocessPowerDetailsLabelBand(imageBuffer, modal),
    preprocessPowerDetailsValueBand(imageBuffer, modal),
    preprocessPowerDetailsValueBandInverted(imageBuffer, modal),
    preprocessPowerDetailsHeaderValue(imageBuffer, modal),
  ]);
  phaseTimings.preprocessMs = Date.now() - preprocessT0;

  const labelT0 = Date.now();
  const labelLinesRaw = await runTesseract(
    labelPre.buffer,
    POWER_DETAILS_LABEL_OCR_CONFIG,
  );
  phaseTimings.labelOcrMs = Date.now() - labelT0;

  const valueT0 = Date.now();
  const valueLinesRaw = await runTesseract(
    valuePre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  const valueInvLinesRaw = await runTesseract(
    valueInvPre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  phaseTimings.valueOcrMs = Date.now() - valueT0;

  const headerT0 = Date.now();
  const headerLinesRaw = await runTesseract(
    headerPre.buffer,
    POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
  );
  phaseTimings.headerOcrMs = Date.now() - headerT0;

  const zipT0 = Date.now();
  const labels = coalesceLabelLines(
    normalizeGeometryLines(toGeometryLines(labelLinesRaw), labelPre.height),
  );
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

  let headerSource: ScreenshotOcrQualityMetrics["headerSource"] = null;
  const labelAnchoredHeader = pickHeroPowerHeaderFromLabelRow(labels, valuesRaw);
  let headerTotal =
    labelAnchoredHeader ??
    pickHeaderTotal(
      headerLinesRaw,
      headerPre.height,
      valueInvLinesRaw,
      valueInvPre.height,
      valueLinesRaw,
      valuePre.height,
    );
  if (headerTotal != null) {
    headerSource = "grey_bar";
  }

  const values = valuesRaw.filter((line) => {
    const asHeader =
      parseDigitsOnlyHeaderTotalLoose(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    return !(headerTotal != null && asHeader === headerTotal);
  });

  const pairs = zipLabelsToValues({ labels, values });
  const reconciledHeader = reconcileHeroPowerHeaderTotal({ headerTotal, pairs });
  const reconciledFromSum =
    reconciledHeader != null &&
    headerTotal != null &&
    reconciledHeader !== headerTotal;
  if (reconciledFromSum) {
    headerSource = "reconciled_sum";
  }
  headerTotal = reconciledHeader;
  const assembled = assembleGeometryParse({ pairs, headerTotal });
  phaseTimings.zipMs = Date.now() - zipT0;

  const unmatchedValues = collectUnmatchedValues(values, pairs);
  const maxZipYNormDistance = pairs.reduce(
    (max, pair) => Math.max(max, pair.zipDist ?? 0),
    0,
  );

  const sharp = (await import("sharp")).default;
  const meta = await sharp(imageBuffer).metadata();
  const sourceWidth = meta.width ?? 1080;
  const sourceHeight = meta.height ?? 1920;

  const headerLine = findHeaderLine(
    headerTotal,
    headerLinesRaw,
    valueInvLinesRaw,
    valueLinesRaw,
  );

  const bboxOverlays = buildThpBboxOverlays({
    modal,
    sourceWidth,
    sourceHeight,
    pairs,
    labelCrop: bandCrops.labelCrop,
    valueCrop: bandCrops.valueCrop,
    labelCropWidth: labelPre.width,
    labelCropHeight: labelPre.height,
    valueCropWidth: valuePre.width,
    valueCropHeight: valuePre.height,
    headerTotal,
    headerLine,
    headerCrop: bandCrops.headerCrop,
    headerCropWidth: headerPre.width,
    headerCropHeight: headerPre.height,
    unmatchedValueLines: unmatchedValues.map((line) => ({
      text: line.text,
      bbox: line.bbox ?? null,
    })),
  });

  const rawLineCount =
    labelLinesRaw.length +
    valueLinesRaw.length +
    valueInvLinesRaw.length +
    headerLinesRaw.length;

  const quality = computeThpScreenshotQuality({
    heroPowerTotal: assembled.heroPowerTotal,
    breakdown: assembled.breakdown,
    complete: assembled.complete,
    pairedCount: assembled.pairedCount,
    unmatchedValueLineCount: unmatchedValues.length,
    maxZipYNormDistance,
    headerSource,
    sourceWidth,
    sourceHeight,
    modalRect: modal,
    modalMethod: modalResolution.method,
    modalDetectConfidence: modalResolution.confidence,
    cropCandidateScores: modalResolution.candidates,
    rawLineCount,
    labelLineCount: labelLinesRaw.length,
    valueLineCount: valueLinesRaw.length,
    invertedValueLineCount: valueInvLinesRaw.length,
    headerLineCount: headerLinesRaw.length,
    phaseTimings,
    reconciledFromSum,
  });

  const sampleLines = [
    ...(options.jobId ? [`job:${options.jobId}`] : []),
    `modal:${modalResolution.method}`,
    ...headerLinesRaw.map((line) => `hdr:${line.text}`),
    ...valueInvLinesRaw.slice(0, 3).map((line) => `inv:${line.text}`),
    ...pairs.map(
      (pair) =>
        `${pair.key ?? "?"}=${pair.valueText} ← ${pair.label.slice(0, 40)}`,
    ),
    ...valueLinesRaw.slice(0, 4).map((line) => `val:${line.text}`),
  ];

  phaseTimings.totalMs = Date.now() - t0;
  const durationMs = phaseTimings.totalMs;

  const diagnostics = buildOcrDiagnostics({
    source: "thp_screenshot",
    durationMs,
    rawLineCount,
    lines: sampleLines,
    parsedOk: quality.parsedOk,
    parsedValue: assembled.heroPowerTotal,
    entryCount: assembled.pairedCount,
    jobId: options.jobId,
    modalRect: modal,
    modalMethod: modalResolution.method,
    failureCodes: quality.failureCodes,
    qualityParsedOk: quality.parsedOk,
    qualityComplete: quality.complete,
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
      modalRect: modal,
      modalMethod: modalResolution.method,
      quality,
      bboxOverlays,
      bandCrops,
      cropCandidates: modalResolution.candidates,
      phaseTimings,
    },
  };
}

export { toThpBreakdown };
