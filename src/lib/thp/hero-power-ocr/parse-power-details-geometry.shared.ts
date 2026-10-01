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
 *   Overlong row crops may still list separator-slot readings; a breakdown is
 *   accepted only when one seven-row combination equals the header total.
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

/** Modal chrome above the Hero Power section (OCR: "POWER DETH", etc.). */
export function isPowerDetailsModalTitle(line: string): boolean {
  const collapsed = line.trim().replace(/[^a-z]/gi, "");
  return /^powerdet/i.test(collapsed);
}

export function isHeroPowerHeaderLabel(line: string): boolean {
  const trimmed = line.trim();
  if (HERO_POWER_HEADER_RE.test(trimmed)) return true;
  // OCR junk still anchors the grey header row: "(BJ [HerolPower", "HerolPower".
  const collapsed = trimmed.replace(/[^a-z]/gi, "");
  return /herol?pow/i.test(collapsed) || /he[li]denkampfkraft/i.test(collapsed);
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

/**
 * Header totals after digits-only OCR sometimes include separator glyphs forced
 * into digits. Repair only structurally valid separator slots in overlong blobs.
 */
export function parseDigitsOnlyHeaderTotalLoose(text: string): number | null {
  const direct = parseDigitsOnlyHeaderTotal(text);
  if (direct != null) return direct;

  const digits = text.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 11) {
    const repaired = [...digits];
    for (let index = repaired.length - 4; index >= 0; index -= 4) {
      repaired.splice(index, 1);
    }
    return parseDigitsOnlyHeaderTotal(repaired.join(""));
  }

  if (digits.length === 10) {
    const commaLike = new Set(["1", "7", "8"]);
    const separatorSlots = [3, 6].filter((index) =>
      commaLike.has(digits[index]!),
    );
    const separatorIndex = separatorSlots[separatorSlots.length - 1];
    if (separatorIndex == null) return null;
    return parseDigitsOnlyHeaderTotal(
      `${digits.slice(0, separatorIndex)}${digits.slice(separatorIndex + 1)}`,
    );
  }

  return null;
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

export function parseDigitsOnlyComponentCandidates(
  text: string,
  maxValue: number,
): number[] {
  const raw = text.replace(/\D/g, "");
  if (!raw) return [];

  const found = new Set<number>();
  for (let targetLength = 5; targetLength <= 9; targetLength += 1) {
    const boundaryCount = Math.floor((targetLength - 1) / 3);
    const firstGroup = targetLength - boundaryCount * 3;
    const extra = raw.length - targetLength;
    if (extra < 0 || extra > boundaryCount) continue;

    const subsets: number[][] = [[]];
    for (let i = 0; i < boundaryCount; i += 1) {
      const size = subsets.length;
      for (let s = 0; s < size; s += 1) {
        subsets.push([...subsets[s]!, i]);
      }
    }

    for (const selected of subsets) {
      if (selected.length !== extra) continue;
      let rawIndex = 0;
      let out = "";
      let ok = true;
      for (let group = 0; group <= boundaryCount && ok; group += 1) {
        const groupLength = group === 0 ? firstGroup : 3;
        for (let c = 0; c < groupLength; c += 1) {
          if (rawIndex >= raw.length) {
            ok = false;
            break;
          }
          out += raw[rawIndex]!;
          rawIndex += 1;
        }
        if (group < boundaryCount && selected.includes(group)) rawIndex += 1;
      }
      if (!ok || rawIndex !== raw.length) continue;
      const value = parseDigitsOnlyComponent(out);
      if (value != null && value > 0 && value <= maxValue) found.add(value);
    }
  }

  return [...found].sort((a, b) => a - b);
}

export function resolveUniqueBreakdownFromCandidates(input: {
  candidates: Partial<Record<ThpBreakdownKey, number[]>>;
  headerTotal: number;
  support?: Partial<Record<ThpBreakdownKey, ReadonlyMap<number, number>>>;
}): ThpBreakdown | null {
  const lists = THP_BREAKDOWN_KEYS.map((key) => {
    const list = input.candidates[key];
    if (!list) return null;
    const votes = input.support?.[key];
    return [...new Set(list)]
      .filter((value) => value > 0 && value <= input.headerTotal)
      .sort((a, b) => (votes?.get(b) ?? 0) - (votes?.get(a) ?? 0) || a - b);
  });
  if (lists.some((list) => list == null || list.length === 0)) return null;

  const keyCount = THP_BREAKDOWN_KEYS.length;
  const suffixMin = new Array<number>(keyCount + 1).fill(0);
  const suffixMax = new Array<number>(keyCount + 1).fill(0);
  for (let i = keyCount - 1; i >= 0; i -= 1) {
    const list = lists[i]!;
    suffixMin[i] = suffixMin[i + 1] + Math.min(...list);
    suffixMax[i] = suffixMax[i + 1] + Math.max(...list);
  }

  const SOLUTION_CAP = 64;
  const VISIT_CAP = 250_000;
  let solutions = 0;
  let visits = 0;
  let searchExhausted = false;
  let best: { values: number[]; score: number } | null = null;
  let bestTies = 0;
  const chosen = new Array<number>(keyCount);

  const scoreOf = (): number => {
    if (!input.support) return 1;
    let score = 0;
    THP_BREAKDOWN_KEYS.forEach((key, index) => {
      score += input.support?.[key]?.get(chosen[index]!) ?? 0;
    });
    return score;
  };

  const visit = (index: number, runningSum: number): boolean => {
    visits += 1;
    if (visits > VISIT_CAP) {
      searchExhausted = true;
      return true;
    }
    if (index === keyCount) {
      if (runningSum !== input.headerTotal) return false;
      solutions += 1;
      if (solutions > SOLUTION_CAP) return true;
      const score = scoreOf();
      if (best == null || score > best.score) {
        best = { values: [...chosen], score };
        bestTies = 1;
      } else if (score === best.score) {
        bestTies += 1;
      }
      return !input.support && solutions >= 2;
    }
    if (
      runningSum + suffixMin[index]! > input.headerTotal ||
      runningSum + suffixMax[index]! < input.headerTotal
    ) {
      return false;
    }
    for (const value of lists[index]!) {
      const nextSum = runningSum + value;
      if (
        nextSum > input.headerTotal ||
        nextSum + suffixMin[index + 1]! > input.headerTotal ||
        nextSum + suffixMax[index + 1]! < input.headerTotal
      ) {
        continue;
      }
      chosen[index] = value;
      if (visit(index + 1, nextSum)) return true;
    }
    return false;
  };

  visit(0, 0);
  if (searchExhausted || solutions > SOLUTION_CAP || best == null) return null;
  if (!input.support && solutions !== 1) return null;
  if (input.support && bestTies !== 1) return null;

  const breakdown = {} as ThpBreakdown;
  THP_BREAKDOWN_KEYS.forEach((key, index) => {
    breakdown[key] = best!.values[index]!;
  });
  return breakdown;
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
  if (commaSevens) return parseDigitsOnlyComponent(commaSevens);

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
    if (isPowerDetailsModalTitle(label.text)) continue;
    // "Stats" orphan when coalesce did not merge a split label — no value row.
    if (/^stats$/i.test(label.text.trim())) continue;

    const key = matchThpLabel(label.text);
    // Unknown / garbage label lines must not consume a value (shifts every row down).
    if (key == null) continue;

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
 * Same-key fragments belong to one wrapped row (German
 * "Dekorationen und" / "Gebäudestatistiken"). A full component row is about
 * 0.08 of the modal; keep the merge inside that pitch so two detections a
 * row apart are not averaged into the gap between them.
 */
const SAME_KEY_LABEL_WRAP_MAX_Y_GAP = 0.06;

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
        // Value is vertically centered on the full two-line row — use midpoint.
        yNorm: (current.yNorm + next.yNorm) / 2,
        yCenterPx:
          current.yCenterPx != null && next.yCenterPx != null
            ? (current.yCenterPx + next.yCenterPx) / 2
            : current.yCenterPx,
      });
      i += 1;
      continue;
    }
    const currentKey = matchThpLabel(current.text);
    if (
      next &&
      currentKey != null &&
      matchThpLabel(next.text) === currentKey &&
      Math.abs(next.yNorm - current.yNorm) <= SAME_KEY_LABEL_WRAP_MAX_Y_GAP
    ) {
      out.push({
        text: `${current.text} ${next.text}`,
        yNorm: (current.yNorm + next.yNorm) / 2,
        yCenterPx:
          current.yCenterPx != null && next.yCenterPx != null
            ? (current.yCenterPx + next.yCenterPx) / 2
            : current.yCenterPx,
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

  const heroPowerTotal = input.headerTotal;
  let working = breakdown;
  if (heroPowerTotal != null) {
    working = fillMissingComponentFromTotal(working, heroPowerTotal);
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
