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
  matchThpLabel,
  THP_BREAKDOWN_KEYS,
  type ThpBreakdownKey,
} from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";
import {
  assembleGeometryParse,
  coalesceLabelLines,
  isHeroPowerHeaderLabel,
  isPowerDetailsModalTitle,
  isPowerDetailsSectionStop,
  normalizeGeometryLines,
  parseDigitsOnlyComponentCandidates,
  parseDigitsOnlyHeaderTotal,
  parseDigitsOnlyHeaderTotalLoose,
  resolveUniqueBreakdownFromCandidates,
  zipLabelsToValues,
  type GeometryOcrLine,
  type LabelValuePair,
  type NormalizedGeometryLine,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import {
  toThpBreakdown,
  type ParsePowerDetailsResult,
} from "@/lib/thp/hero-power-ocr/parse-power-details";
import { readInGameScreenshotLayout } from "@/lib/ocr/in-game-crop";
import type { InGameScreenshotLayout } from "@/lib/ocr/in-game-crop.shared";
import {
  POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
  POWER_DETAILS_LABEL_OCR_CONFIG,
  POWER_DETAILS_VALUE_OCR_CONFIG,
  preprocessPowerDetailsComponentValueRow,
  preprocessPowerDetailsHeaderValue,
  cropPowerDetailsValueRow,
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
    layout: InGameScreenshotLayout;
  };
};

type HeaderOcrPass = {
  lines: OcrLineResult[];
  cropHeight: number;
};

const COMPONENT_ROW_OFFSETS = [-0.015, -0.005, 0.005, 0.015] as const;
const COMPONENT_ROW_INITIAL_HEIGHTS = [0.05] as const;
const COMPONENT_ROW_FALLBACK_HEIGHTS = [0.035, 0.04, 0.045] as const;

/** A menu-only crop is mostly the hero section, so each row is a larger share of the file. */
const MENU_COMPONENT_ROW_OFFSETS = [-0.02, 0, 0.02] as const;
const MENU_COMPONENT_ROW_INITIAL_HEIGHTS = [0.09] as const;
const MENU_COMPONENT_ROW_FALLBACK_HEIGHTS = [0.07, 0.11] as const;

function componentRowScan(layout: InGameScreenshotLayout) {
  if (layout === "menu") {
    return {
      offsets: MENU_COMPONENT_ROW_OFFSETS,
      initial: MENU_COMPONENT_ROW_INITIAL_HEIGHTS,
      fallback: MENU_COMPONENT_ROW_FALLBACK_HEIGHTS,
      focusedHeight: 0.11,
    };
  }
  return {
    offsets: COMPONENT_ROW_OFFSETS,
    initial: COMPONENT_ROW_INITIAL_HEIGHTS,
    fallback: COMPONENT_ROW_FALLBACK_HEIGHTS,
    focusedHeight: 0.07,
  };
}

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

export function pickHeaderTotal(
  labels: NormalizedGeometryLine[],
  focusedHeaderPasses: HeaderOcrPass[],
  headerLines: OcrLineResult[],
  headerCropHeight: number,
  invertedValueLines: OcrLineResult[],
  invertedCropHeight: number,
  valueLines: OcrLineResult[],
  valueCropHeight: number,
): number | null {
  const headerLabel = labels.find((line) => isHeroPowerHeaderLabel(line.text));
  if (!headerLabel) {
    return pickBestHeaderCandidate(headerLines, headerCropHeight);
  }

  const focusedTotals = focusedHeaderPasses
    .map((pass) => pickBestHeaderCandidate(pass.lines, pass.cropHeight))
    .filter((value): value is number => value != null);
  if (focusedTotals.length > 0) {
    return focusedTotals.every((value) => value === focusedTotals[0])
      ? focusedTotals[0]!
      : null;
  }

  const alignedCandidates = [
    ...collectHeaderCandidates(invertedValueLines, invertedCropHeight),
    ...collectHeaderCandidates(valueLines, valueCropHeight),
  ]
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.yNorm - headerLabel.yNorm),
    }))
    .filter((candidate) => candidate.distance <= 0.04)
    .sort((a, b) => a.distance - b.distance);

  return alignedCandidates[0]?.value ?? null;
}

function collectHeaderCandidates(
  lines: OcrLineResult[],
  cropHeight: number,
): Array<{ yNorm: number; value: number }> {
  const candidates: Array<{ yNorm: number; value: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const normalized =
      parseDigitsOnlyHeaderTotalLoose(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    if (normalized == null) continue;
    if (normalized < 100_000_000 || normalized > 1_000_000_000) continue;

    const yNorm =
      lineYNorm(line, cropHeight) ??
      (lines.length > 1 ? index / (lines.length - 1) : 0);
    candidates.push({ yNorm, value: normalized });
  }

  candidates.sort((a, b) => a.yNorm - b.yNorm);
  return candidates;
}

function pickBestHeaderCandidate(
  lines: OcrLineResult[],
  cropHeight: number,
): number | null {
  return collectHeaderCandidates(lines, cropHeight)[0]?.value ?? null;
}


export async function parsePowerDetailsImage(
  imageBuffer: Buffer,
  layoutOverride?: InGameScreenshotLayout,
): Promise<ParsePowerDetailsImageResult> {
  const t0 = Date.now();
  const layout =
    layoutOverride ?? (await readInGameScreenshotLayout(imageBuffer));
  const rowScan = componentRowScan(layout);

  const [labelPre, valuePre, valueInvPre, headerPre] = await Promise.all([
    preprocessPowerDetailsLabelBand(imageBuffer, undefined, layout),
    preprocessPowerDetailsValueBand(imageBuffer, undefined, layout),
    preprocessPowerDetailsValueBandInverted(imageBuffer, undefined, layout),
    preprocessPowerDetailsHeaderValue(imageBuffer, undefined, layout),
  ]);

  // Tesseract worker is serialized internally — await sequentially for clarity.
  const labelLinesRaw = await runTesseract(
    labelPre.buffer,
    POWER_DETAILS_LABEL_OCR_CONFIG,
  );
  const labels = coalesceLabelLines(
    normalizeGeometryLines(toGeometryLines(labelLinesRaw), labelPre.height),
  );

  const headerLabel = labels.find((line) => isHeroPowerHeaderLabel(line.text));
  // Menu crops keep the header's dropdown in the value column. Tesseract
  // reads that button as an extra 1 and the comma-slot repair shifts.
  // Component numbers are right-aligned past the button, so only this crop
  // stops short of it.
  const headerWidthFraction = layout === "menu" ? 0.7 : 1;
  const focusedNormalPre = headerLabel
    ? await cropPowerDetailsValueRow(
        valuePre,
        headerLabel.yNorm,
        rowScan.focusedHeight,
        headerWidthFraction,
      )
    : null;
  const focusedInvertedPre = headerLabel
    ? await cropPowerDetailsValueRow(
        valueInvPre,
        headerLabel.yNorm,
        rowScan.focusedHeight,
        headerWidthFraction,
      )
    : null;

  const valueLinesRaw = await runTesseract(
    valuePre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  const valueInvLinesRaw = await runTesseract(
    valueInvPre.buffer,
    POWER_DETAILS_VALUE_OCR_CONFIG,
  );
  const focusedNormalLinesRaw = focusedNormalPre
    ? await runTesseract(
        focusedNormalPre.buffer,
        POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
      )
    : [];
  const focusedInvertedLinesRaw = focusedInvertedPre
    ? await runTesseract(
        focusedInvertedPre.buffer,
        POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
      )
    : [];
  const headerLinesRaw = headerLabel
    ? []
    : await runTesseract(
        headerPre.buffer,
        POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
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

  const focusedHeaderPasses: HeaderOcrPass[] = [];
  if (focusedNormalPre) {
    focusedHeaderPasses.push({
      lines: focusedNormalLinesRaw,
      cropHeight: focusedNormalPre.height,
    });
  }
  if (focusedInvertedPre) {
    focusedHeaderPasses.push({
      lines: focusedInvertedLinesRaw,
      cropHeight: focusedInvertedPre.height,
    });
  }

  const headerTotal = pickHeaderTotal(
    labels,
    focusedHeaderPasses,
    headerLinesRaw,
    headerPre.height,
    valueInvLinesRaw,
    valueInvPre.height,
    valueLinesRaw,
    valuePre.height,
  );

  // The value column still contains the header-row total on the right. Drop it
  // so it cannot be y-zipped onto Hero Level (same failure mode as freeform
  // attaching the total to the wrong row).
  const values = valuesRaw.filter((line) => {
    const asHeader =
      parseDigitsOnlyHeaderTotalLoose(line.text) ??
      parseDigitsOnlyHeaderTotal(line.text);
    // Only drop the grey-bar total itself — not component rows misread as headers.
    return !(headerTotal != null && asHeader === headerTotal);
  });

  const componentRowSamples: string[] = [];
  let componentRawCount = 0;
  let pairs: LabelValuePair[] | null = null;
  if (headerTotal != null) {
    const sortedLabels = [...labels].sort((a, b) => a.yNorm - b.yNorm);
    const componentLabels: Array<{
      label: string;
      key: ThpBreakdownKey;
      yNorm: number;
    }> = [];
    let inHeroSection = headerLabel == null;
    for (const label of sortedLabels) {
      if (label === headerLabel) {
        inHeroSection = true;
        continue;
      }
      if (!inHeroSection) continue;
      if (isPowerDetailsSectionStop(label.text)) break;
      if (isPowerDetailsModalTitle(label.text)) continue;
      if (isHeroPowerHeaderLabel(label.text)) continue;
      const key = matchThpLabel(label.text);
      if (key == null) continue;
      if (!componentLabels.some((row) => row.key === key)) {
        componentLabels.push({ label: label.text, key, yNorm: label.yNorm });
      }
    }

    const rowTexts = new Map<ThpBreakdownKey, string[]>();
    if (layout === "menu") {
      // The value column is one line per row on a menu-only crop. Seed
      // those reads so comma-slot repair runs on them; the tighter row
      // crops often slice the outlined digits.
      for (const row of componentLabels) {
        const texts: string[] = [];
        for (const line of values) {
          if (Math.abs(line.yNorm - row.yNorm) <= 0.03) texts.push(line.text);
        }
        if (texts.length > 0) rowTexts.set(row.key, texts);
      }
    }
    const ocrComponentRows = async (heightFractions: readonly number[]) => {
      for (const row of componentLabels) {
        const texts = rowTexts.get(row.key) ?? [];
        for (const heightFraction of heightFractions) {
          for (const offset of rowScan.offsets) {
            const pre = await preprocessPowerDetailsComponentValueRow(
              imageBuffer,
              row.yNorm,
              offset,
              heightFraction,
              layout,
            );
            const lines = await runTesseract(
              pre.buffer,
              POWER_DETAILS_HEADER_VALUE_OCR_CONFIG,
            );
            componentRawCount += lines.length;
            for (const line of lines) texts.push(line.text);
          }
        }
        rowTexts.set(row.key, texts);
      }
    };

    const resolveFromTexts = (): ThpBreakdown | null => {
      const candidates: Partial<Record<ThpBreakdownKey, number[]>> = {};
      const support: Partial<Record<ThpBreakdownKey, Map<number, number>>> = {};
      for (const row of componentLabels) {
        const found = new Set<number>();
        const keySupport = new Map<number, number>();
        for (const text of rowTexts.get(row.key) ?? []) {
          for (const value of parseDigitsOnlyComponentCandidates(
            text,
            headerTotal,
          )) {
            found.add(value);
            keySupport.set(value, (keySupport.get(value) ?? 0) + 1);
          }
        }
        candidates[row.key] = [...found].sort((a, b) => a - b);
        support[row.key] = keySupport;
      }
      return resolveUniqueBreakdownFromCandidates({
        candidates,
        headerTotal,
        support,
      });
    };

    await ocrComponentRows(rowScan.initial);
    let resolved = resolveFromTexts();
    if (resolved == null) {
      await ocrComponentRows(rowScan.fallback);
      resolved = resolveFromTexts();
    }
    for (const row of componentLabels) {
      componentRowSamples.push(
        `row:${row.key}:${(rowTexts.get(row.key) ?? []).join("|")}`,
      );
    }

    if (resolved) {
      pairs = THP_BREAKDOWN_KEYS.map((key, index) => {
        const row = componentLabels.find((entry) => entry.key === key);
        return {
          label: row?.label ?? key,
          valueText: String(resolved[key]),
          key,
          value: resolved[key],
          yNorm: row?.yNorm ?? index,
        };
      });
    }
  }
  if (pairs == null) {
    pairs = zipLabelsToValues({ labels, values });
  }
  const assembled = assembleGeometryParse({ pairs, headerTotal });

  // Pair assignments stay ahead of per-row crop dumps. Diagnostics keep
  // only the first 12 lines, and the crop dumps would otherwise evict the
  // `key=value` lines the live fixtures assert.
  const sampleLines = [
    ...headerLinesRaw.map((line) => `hdr:${line.text}`),
    ...focusedNormalLinesRaw.map((line) => `rowN:${line.text}`),
    ...focusedInvertedLinesRaw.map((line) => `rowI:${line.text}`),
    ...valueInvLinesRaw.slice(0, 2).map((line) => `inv:${line.text}`),
    ...pairs.map(
      (pair) =>
        `${pair.key ?? "?"}=${pair.valueText} ← ${pair.label.slice(0, 40)}`,
    ),
    ...componentRowSamples,
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
      focusedNormalLinesRaw.length +
      focusedInvertedLinesRaw.length +
      headerLinesRaw.length +
      componentRawCount,
    lines: sampleLines,
    parsedOk: assembled.complete && assembled.heroPowerTotal != null,
    parsedValue: assembled.heroPowerTotal,
    entryCount: assembled.pairedCount,
  });
  logOcrDiagnostics(diagnostics);

  const result: ParsePowerDetailsImageResult = {
    heroPowerTotal: assembled.heroPowerTotal,
    breakdown: assembled.breakdown,
    complete: assembled.complete,
    diagnostics: {
      rawLineCount: diagnostics.rawLineCount,
      durationMs: diagnostics.durationMs,
      sampleLines: diagnostics.sampleLines,
      pairedCount: assembled.pairedCount,
      layout,
    },
  };

  // A wide frame with no resource bar uses menu geometry. If that crop
  // finds no header, the file is a full screenshot whose HUD OCR missed,
  // so retry the phone window instead of failing the upload.
  if (
    layoutOverride == null &&
    layout === "menu" &&
    result.heroPowerTotal == null
  ) {
    return parsePowerDetailsImage(imageBuffer, "phone");
  }

  return result;
}

export { toThpBreakdown };
