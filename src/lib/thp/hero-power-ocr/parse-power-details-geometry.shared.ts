/**
 * Geometry-first Power Details assembly (no Tesseract).
 *
 * ## Contract
 *
 * - **Labels** come from the left column (any locale aliases via `matchThpLabel`).
 * - **Values** come from the right column as **digits-only** strings (whitelist
 *   `0123456789`). Thousand commas are excluded from the charset; Tesseract may
 *   still *map* a comma glyph onto a nearby digit — see
 *   {@link normalizeDigitsOnlyComponent} for the narrow length fix that remains.
 * - **Header total** comes from a dedicated / inverted value-column reading when
 *   available; otherwise from the sum of seven components (see assemble).
 * - Rows are paired by **normalized y-center** within each crop.
 *
 * ## What this deliberately does NOT do
 *
 * - No combinatorial digit-confusion search (`candidateDigitRepairs` floods).
 * - No fixed row index → breakdown key (pt-BR/KO reorder components).
 */

import {
  matchThpLabel,
  sumThpBreakdown,
  THP_BREAKDOWN_KEYS,
  type ThpBreakdownKey,
} from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";
import type { ParsePowerDetailsResult } from "@/lib/thp/hero-power-ocr/parse-power-details";
import { stripOcrCommaSevens } from "@/lib/thp/hero-power-ocr/parse-power-details";

/** Line with optional geometry from Tesseract `blocks`. */
export type GeometryOcrLine = {
  text: string;
  /** Line bbox in the **cropped** image that produced this line. */
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
};

export type NormalizedGeometryLine = {
  text: string;
  /** Vertical center in [0, 1] within the crop that produced the line. */
  yNorm: number;
  /** Raw y-center in crop pixels (diagnostics). */
  yCenterPx: number | null;
};

export type LabelValuePair = {
  label: string;
  valueText: string;
  key: ThpBreakdownKey | null;
  value: number | null;
  yNorm: number;
};

/** Hero Power / Heldenkampfkraft / … header row (not a breakdown component). */
const HERO_POWER_HEADER_RE =
  /hero\s*l?\s*powers?|helden\s*kampf\s*kraft|poder\s*do\s*her[oó]i|poder\s*de\s*h[eé]roe|영웅\s*전투력/i;

/** Stop pairing once we leave the Hero Power section. */
const SECTION_STOP_RE =
  /^(drone\s*power|drone\s*level|skill\s*chip|drone\s*component|building\s*power|buildings?\b|drohnen[\s-]*kampf\s*kraft|drohnen[\s-]*level|f[äa]higkeits?\s*chip|drohnen\s*komponente|geb[äa]ude[\s-]*kampf\s*kraft|poder\s*do\s*drone|n[ií]vel\s*do\s*drone|componente\s*de\s*drone|chip\s*de\s*habilidade|poder\s*de\s*constru|poder\s*de\s*dron|nivel\s*de\s*dron|componente\s*de\s*dron|chip\s*de\s*habilidad|poder\s*de\s*edificio|edificios?\b|드론\s*전투력|드론\s*레벨|드론\s*파츠|스킬\s*칩|건물\s*전투력|생존자)/i;

const SECTION_STOP_FUZZY_RE =
  /(?:drone|dron|10ne)\s*powers?|building\s*powers?/i;

export function isHeroPowerHeaderLabel(line: string): boolean {
  return HERO_POWER_HEADER_RE.test(line.trim());
}

export function isPowerDetailsSectionStop(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isHeroPowerHeaderLabel(trimmed)) return false;
  return SECTION_STOP_RE.test(trimmed) || SECTION_STOP_FUZZY_RE.test(trimmed);
}

/**
 * Parse a digits-only OCR blob into an integer.
 *
 * Assumption: the value crop used a digits-only whitelist, so `text` should
 * already be contiguous digits (possibly with spaces). We strip non-digits
 * defensively but do **not** attempt separator-digit surgery.
 */
export function parseDigitsOnlyValue(
  text: string,
  opts: { min: number; max: number; minDigits?: number; maxDigits?: number } = {
    min: 10_000,
    max: 1_000_000_000,
  },
): number | null {
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  const minDigits = opts.minDigits ?? 5;
  const maxDigits = opts.maxDigits ?? 9;
  if (digits.length < minDigits || digits.length > maxDigits) return null;
  if (digits.startsWith("0")) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value) || value < opts.min || value > opts.max) {
    return null;
  }
  return value;
}

/** Header totals are typically 8–9 digits (tens/hundreds of millions). */
export function parseDigitsOnlyHeaderTotal(text: string): number | null {
  return parseDigitsOnlyValue(text, {
    min: 1_000_000,
    max: 1_000_000_000,
    minDigits: 7,
    maxDigits: 9,
  });
}

/** Component rows are typically 7–8 digits. */
export function parseDigitsOnlyComponent(text: string): number | null {
  return parseDigitsOnlyValue(text, {
    min: 10_000,
    max: 1_000_000_000,
    minDigits: 5,
    maxDigits: 9,
  });
}

/**
 * Last-mile length fix after digits-only OCR.
 *
 * Even with whitelist `0123456789`, Tesseract often maps a thousand-comma onto
 * a digit (`1`/`7`). We only undo **structured** separator-slot pollution —
 * not a combinatorial digit-repair search:
 * 1. `stripOcrCommaSevens` when every separator slot is a `7`
 * 2. Drop index-2 on 9-digit blobs when that slot is comma-like (`1`/`7`/`8`)
 * 3. Prefix `12`/`17`/`71`/`15` → `7` (crossed seven misread as two glyphs)
 */
export function normalizeDigitsOnlyComponent(rawDigits: string): number | null {
  let digits = rawDigits.replace(/\D/g, "");
  if (!digits) return null;

  const commaSevens = stripOcrCommaSevens(digits);
  if (commaSevens) digits = commaSevens;

  // Same pattern when one separator slot is `1` instead of `7`
  // (`9,408,080` → `974081080`). Only for 7-digit values with a leading `9`
  // (exclusive-weapon sized) — not 8-digit deco readings that also have `7` at [1].
  if (
    digits.length === 9 &&
    digits[0] === "9" &&
    digits[1] === "7" &&
    (digits[5] === "1" || digits[5] === "7")
  ) {
    digits = `${digits[0]}${digits.slice(2, 5)}${digits.slice(6)}`;
  }

  // Drop a single interior comma-mapped `1` to restore 7–8 digits.
  // (Do not drop `7` here — real component values often contain 7s; separator
  // `7`s are already handled by stripOcrCommaSevens.)
  if (digits.length === 9) {
    for (let i = 1; i < digits.length - 1; i += 1) {
      if (digits[i] !== "1") continue;
      const next = `${digits.slice(0, i)}${digits.slice(i + 1)}`;
      if (next.length === 8 || next.length === 7) {
        digits = next;
        break;
      }
    }
  }

  // Both thousand-separators mapped to digits (`37,811,658` → `3718117658`).
  if (digits.length === 10) {
    const sepA = digits[2]!;
    const sepB = digits[6]!;
    if (
      (sepA === "1" || sepA === "7") &&
      (sepB === "1" || sepB === "7")
    ) {
      digits = `${digits.slice(0, 2)}${digits.slice(3, 6)}${digits.slice(7)}`;
    }
  }

  // Extra interior `1` after a 7-digit mid-tier reading (`6,581,990` → `65811990`).
  // Skip level/deco-sized 8-digit values (leading 1–4).
  if (digits.length === 8 && digits[4] === "1" && /^[5-9]/.test(digits)) {
    const dropped = `${digits.slice(0, 4)}${digits.slice(5)}`;
    if (dropped.length === 7) digits = dropped;
  }

  for (const [from, to] of [
    ["12", "7"],
    ["17", "7"],
    ["71", "7"],
    ["15", "7"],
  ] as const) {
    if (digits.startsWith(from)) {
      digits = `${to}${digits.slice(from.length)}`;
      break;
    }
  }

  return parseDigitsOnlyComponent(digits);
}

function lineYCenterPx(line: GeometryOcrLine): number | null {
  const box = line.bbox;
  if (!box) return null;
  if (
    !Number.isFinite(box.y0) ||
    !Number.isFinite(box.y1) ||
    box.y1 < box.y0
  ) {
    return null;
  }
  return (box.y0 + box.y1) / 2;
}

/**
 * Normalize lines to y ∈ [0,1] within the crop.
 * Falls back to evenly spaced order when bboxes are missing (text-only OCR).
 */
export function normalizeGeometryLines(
  lines: GeometryOcrLine[],
  cropHeightPx: number,
): NormalizedGeometryLine[] {
  const withCenters = lines
    .map((line) => {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (!text) return null;
      const yCenterPx = lineYCenterPx(line);
      return { text, yCenterPx };
    })
    .filter((row): row is { text: string; yCenterPx: number | null } => row != null);

  const height = Math.max(1, cropHeightPx);
  const anyBbox = withCenters.some((row) => row.yCenterPx != null);

  if (!anyBbox) {
    const n = Math.max(1, withCenters.length);
    return withCenters.map((row, index) => ({
      text: row.text,
      yNorm: (index + 0.5) / n,
      yCenterPx: null,
    }));
  }

  return withCenters.map((row, index) => {
    const yCenterPx =
      row.yCenterPx ?? ((index + 0.5) / Math.max(1, withCenters.length)) * height;
    return {
      text: row.text,
      yNorm: Math.min(1, Math.max(0, yCenterPx / height)),
      yCenterPx: row.yCenterPx,
    };
  });
}

/**
 * Pair each label line with the nearest unused value line by normalized y.
 *
 * Stops when a section-stop label is seen (Drone / Building). Skips the Hero
 * Power header label itself (total comes from the header-value crop).
 *
 * Max |ΔyNorm| of 0.08 ≈ ~8% of modal height — about one row at typical density.
 */
export function zipLabelsToValues(input: {
  labels: NormalizedGeometryLine[];
  values: NormalizedGeometryLine[];
  maxYNormDistance?: number;
}): LabelValuePair[] {
  const maxDist = input.maxYNormDistance ?? 0.08;
  const unusedValues = [...input.values];
  const pairs: LabelValuePair[] = [];

  const labelsSorted = [...input.labels].sort((a, b) => a.yNorm - b.yNorm);

  for (const label of labelsSorted) {
    if (isPowerDetailsSectionStop(label.text)) break;
    if (isHeroPowerHeaderLabel(label.text)) continue;
    // "POWER DETAILS" title / "Stats" orphan continuation — no value of their own.
    if (/^power\s*details$/i.test(label.text)) continue;
    if (/^stats$/i.test(label.text.trim())) continue;

    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < unusedValues.length; i += 1) {
      const candidate = unusedValues[i]!;
      const dist = Math.abs(candidate.yNorm - label.yNorm);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > maxDist) continue;

    const [valueLine] = unusedValues.splice(bestIdx, 1);
    if (!valueLine) continue;

    // Prefer coalesced "Decorations & Building" + following "Stats" already in text;
    // matchThpLabel handles both "Decorations & Building Stats" and split forms via aliases.
    const key = matchThpLabel(label.text);
    const value = normalizeDigitsOnlyComponent(valueLine.text);
    pairs.push({
      label: label.text,
      valueText: valueLine.text,
      key,
      value,
      yNorm: label.yNorm,
    });
  }

  return pairs;
}

/**
 * Coalesce a label that is only "Decorations & Building" with a following
 * "Stats" line (common OCR split) before matching.
 */
export function coalesceLabelLines(
  labels: NormalizedGeometryLine[],
): NormalizedGeometryLine[] {
  const out: NormalizedGeometryLine[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const current = labels[i]!;
    const next = labels[i + 1];
    if (
      next &&
      /decorations?\s*&?\s*building/i.test(current.text) &&
      !/stats/i.test(current.text) &&
      /^stats$/i.test(next.text.trim())
    ) {
      out.push({
        text: `${current.text} Stats`,
        yNorm: current.yNorm,
        yCenterPx: current.yCenterPx,
      });
      i += 1;
      continue;
    }
    out.push(current);
  }
  return out;
}

/** If exactly one breakdown key is missing, fill from header − known sum. */
export function fillMissingComponentFromTotal(
  breakdown: Partial<ThpBreakdown>,
  heroPowerTotal: number,
): Partial<ThpBreakdown> {
  const present = THP_BREAKDOWN_KEYS.filter(
    (key) => typeof breakdown[key] === "number" && breakdown[key]! > 0,
  );
  if (present.length !== THP_BREAKDOWN_KEYS.length - 1) return breakdown;
  const missing = THP_BREAKDOWN_KEYS.find(
    (key) => typeof breakdown[key] !== "number" || !(breakdown[key]! > 0),
  );
  if (!missing) return breakdown;
  const knownSum = present.reduce((sum, key) => sum + breakdown[key]!, 0);
  const inferred = heroPowerTotal - knownSum;
  if (!Number.isFinite(inferred) || inferred <= 0) return breakdown;
  return { ...breakdown, [missing]: inferred };
}

/**
 * Assemble a parse result from geometry pairs + digits-only header total.
 *
 * Completeness requires all seven keys and sum === header (no digit surgery).
 * Optional soft fill for a single missing row when the header is known.
 */
export function assembleGeometryParse(input: {
  pairs: LabelValuePair[];
  headerTotal: number | null;
}): ParsePowerDetailsResult & { pairedCount: number } {
  const breakdown: Partial<ThpBreakdown> = {};
  for (const pair of input.pairs) {
    if (pair.key == null || pair.value == null) continue;
    // First write wins — duplicate labels keep the earlier (higher) row.
    if (breakdown[pair.key] != null) continue;
    breakdown[pair.key] = pair.value;
  }

  let heroPowerTotal = input.headerTotal;
  let working = breakdown;
  if (heroPowerTotal != null) {
    working = fillMissingComponentFromTotal(working, heroPowerTotal);
  } else {
    // Header crop often misses white-on-grey totals. If all seven components
    // parsed, use their sum as the total (same number the UI shows on the bar).
    const allPresent = THP_BREAKDOWN_KEYS.every(
      (key) => typeof working[key] === "number" && working[key]! > 0,
    );
    if (allPresent) {
      const sum = sumThpBreakdown(working as ThpBreakdown);
      if (sum >= 1_000_000 && sum <= 1_000_000_000) {
        heroPowerTotal = sum;
      }
    }
  }

  const allPresent = THP_BREAKDOWN_KEYS.every(
    (key) => typeof working[key] === "number" && working[key]! > 0,
  );
  let complete = false;
  if (allPresent && heroPowerTotal != null) {
    const sum = sumThpBreakdown(working as ThpBreakdown);
    complete = sum === heroPowerTotal;
  }

  return {
    heroPowerTotal,
    breakdown: working,
    complete,
    pairedCount: input.pairs.filter((p) => p.key != null && p.value != null).length,
  };
}
