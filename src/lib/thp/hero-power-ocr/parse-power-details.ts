/**
 * Parse OCR text lines from the in-game Power Details screen.
 *
 * Tesseract often turns thousand-separators into apostrophes, dashes, slashes,
 * brackets, currency glyphs, or the digit `7` (`14,833,300` → `1478337300`).
 * Value extraction must tolerate that junk and strip separator-`7`s. Drone /
 * Building sections are ignored.
 */

import {
  matchThpLabel,
  parseIntegerToken,
  sumThpBreakdown,
  type ThpBreakdownKey,
  THP_BREAKDOWN_KEYS,
} from "@/lib/thp/breakdown.shared";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";

export type ParsePowerDetailsResult = {
  heroPowerTotal: number | null;
  breakdown: Partial<ThpBreakdown>;
  complete: boolean;
};

const HERO_POWER_HEADER_RE =
  /hero\s*l?\s*powers?|helden\s*kampf\s*kraft|poder\s*do\s*her[oó]i|poder\s*de\s*h[eé]roe|영웅\s*전투력/i;
const SECTION_STOP_RE =
  /^(drone\s*power|drone\s*level|skill\s*chip|drone\s*component|building\s*power|buildings?\b|drohnen[\s-]*kampf\s*kraft|drohnen[\s-]*level|f[äa]higkeits?\s*chip|drohnen\s*komponente|geb[äa]ude[\s-]*kampf\s*kraft|poder\s*do\s*drone|n[ií]vel\s*do\s*drone|componente\s*de\s*drone|chip\s*de\s*habilidade|poder\s*de\s*constru|poder\s*de\s*dron|nivel\s*de\s*dron|componente\s*de\s*dron|chip\s*de\s*habilidad|poder\s*de\s*edificio|edificios?\b|드론\s*전투력|드론\s*레벨|드론\s*파츠|스킬\s*칩|건물\s*전투력|생존자)/i;
/** Fuzzy drone/building section header — OCR often mangles "Drone Power" → "R4D10nePower". */
const SECTION_STOP_FUZZY_RE =
  /(?:drone|dron|10ne)\s*powers?|building\s*powers?/i;

/**
 * Trailing numeric blob: digits plus common OCR substitutes for commas / noise.
 * Must not include letters so labels stay in the label half.
 */
const TRAILING_NUMBER_BLOB_RE =
  /(\d[\d\s,.'`´’′″/\\|_\-\[\](){}%!¥$€#@~+=?]*)/g;

/** Digits that Tesseract commonly swaps on Power Details screenshots. */
const DIGIT_CONFUSIONS: ReadonlyArray<readonly [string, string]> = [
  ["1", "7"],
  ["7", "1"],
  ["5", "7"],
  ["7", "5"],
  ["3", "7"],
  ["7", "3"],
  ["0", "8"],
  ["8", "0"],
  ["2", "7"],
  ["7", "2"],
  ["2", "4"],
  ["4", "2"],
];

/** Multi-glyph misreads of a crossed `7` (often emitted as `12` / `17`). */
const PREFIX_CONFUSIONS: ReadonlyArray<readonly [string, string]> = [
  ["12", "7"],
  ["17", "7"],
  ["71", "7"],
  ["15", "7"],
];

/**
 * Map OCR glyphs that commonly stand in for thousand-separators on this screen.
 * Crossed `7` sometimes becomes `%`, but `%` also replaces commas — treat as a
 * separator so `4%,02¥,00` stays a destroyed stub and `85%857'448` keeps 8 digits.
 */
function normalizePowerDetailsNumberBlob(blob: string): string {
  return blob
    .replace(/%/g, ",")
    .replace(/[¥€$]/g, ",")
    .replace(/:/g, ",")
    .replace(/[!?|]+$/g, "");
}

/**
 * Tesseract often reads thin thousand-commas as the digit `7`
 * (`14,833,300` → `1478337300`). Walk right-to-left in groups of three digits
 * and drop a `7` sitting in each separator slot — but only when the number of
 * dropped `7`s matches the expected comma count for the remaining value
 * (avoids eating a real `7` in `85,857,448`).
 */
export function stripOcrCommaSevens(digits: string): string | null {
  const chars = digits.replace(/\D/g, "");
  if (chars.length < 5) return null;

  let i = chars.length - 1;
  const kept: string[] = [];
  let skipped = 0;

  while (i >= 0) {
    let taken = 0;
    while (taken < 3 && i >= 0) {
      kept.push(chars[i]!);
      i -= 1;
      taken += 1;
    }
    if (i < 0) break;
    if (chars[i] === "7") {
      i -= 1;
      skipped += 1;
      continue;
    }
    // Separator slot was not a 7 — only valid when the leftover is a short head.
    if (i >= 3) return null;
  }

  if (skipped === 0) return null;
  const next = kept.reverse().join("");
  if (!next || next.startsWith("0")) return null;
  const expectedCommas = Math.floor((next.length - 1) / 3);
  if (skipped !== expectedCommas) return null;
  if (chars.length !== next.length + skipped) return null;
  return next;
}

function isCommaConfusionSeparator(ch: string, leadingDigit: string): boolean {
  if (ch === "1" || ch === "7") return true;
  // `8` only for gear-like values starting with `1` (`13,190,850` → `138190850`).
  return ch === "8" && leadingDigit === "1";
}

/**
 * Collapse OCR'd thousand-separator digits back out of values.
 *
 * - 9 digits: one sep inserted into an 8-digit value (`85,868,520` →
 *   `857868520`). Delete index 2 when that digit looks like a comma
 *   confusion. Avoids eating a trailing ghost `8` on `85,857,244 8!` →
 *   `858572448`.
 * - 10 digits: both seps inserted into an 8-digit value
 *   (`85,868,520` → `8578681520`). Delete indices 2 and 6.
 * - 11 digits: both seps inserted into a 9-digit header
 *   (`164,613,299` → `16416135299` when seps read as `1`/`5` is handled via
 *   digit-repair candidates; structured collapse only when sep slots are
 *   comma-like `1`/`7`/`8`).
 */
function collapseInsertedSeparatorDigit(
  value: number,
  maxValue = 1_000_000_000,
): number {
  const digits = String(value);
  const leading = digits[0]!;

  const tryDelete = (indices: number[]): number | null => {
    for (const index of indices) {
      if (!isCommaConfusionSeparator(digits[index]!, leading)) return null;
    }
    let next = digits;
    for (const index of [...indices].sort((a, b) => b - a)) {
      next = `${next.slice(0, index)}${next.slice(index + 1)}`;
    }
    if (!next || next.startsWith("0")) return null;
    const collapsed = Number.parseInt(next, 10);
    if (
      !Number.isFinite(collapsed) ||
      collapsed < 1_000_000 ||
      collapsed > maxValue
    ) {
      return null;
    }
    return collapsed;
  };

  if (digits.length === 9) {
    return tryDelete([2]) ?? value;
  }
  if (digits.length === 10) {
    return tryDelete([2, 6]) ?? value;
  }
  if (digits.length === 11) {
    // Headers are xxx,xxx,xxx. When the raw blob is already >1B, both
    // thousand-separators were absorbed as digits — always strip the sep
    // slots (indices 3 and 7), even if OCR emitted junk there (`5`, etc.).
    // Comma-like-only collapse is too strict for dual-pass header noise.
    if (value > 1_000_000_000) {
      const structured = Number.parseInt(
        `${digits.slice(0, 3)}${digits.slice(4, 7)}${digits.slice(8)}`,
        10,
      );
      if (
        Number.isFinite(structured) &&
        structured >= 1_000_000 &&
        structured <= maxValue &&
        !String(structured).startsWith("0")
      ) {
        return structured;
      }
    }
    return tryDelete([3, 7]) ?? value;
  }
  return value;
}

function parsePowerDetailsInteger(token: string): number | null {
  const normalized = normalizePowerDetailsNumberBlob(token);
  const raw = parseIntegerToken(normalized);
  if (raw == null) return null;
  const stripped = stripOcrCommaSevens(String(raw));
  if (stripped != null) {
    const value = Number.parseInt(stripped, 10);
    if (Number.isFinite(value)) return value;
  }
  return raw;
}

/** Bare / near-bare numeric line that can stand in for a destroyed Hero Power header. */
function extractBareHeroPowerTotal(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (matchThpLabel(trimmed) != null) return null;
  if (SECTION_STOP_RE.test(trimmed)) return null;
  // Reject lines that still look like labeled rows (letters beyond short OCR junk).
  const letterRuns = trimmed.match(/[A-Za-zÀ-ÿ가-힣]{3,}/g) ?? [];
  if (letterRuns.some((run) => !HERO_POWER_HEADER_RE.test(run))) {
    return null;
  }
  const value = extractTrailingNumber(trimmed);
  if (value == null) return null;
  if (value < 1_000_000 || value > 1_000_000_000) return null;
  return value;
}

function extractTrailingNumber(line: string): number | null {
  const trimmed = line.trim().replace(/[!?|]+$/g, "");
  const matches = [...trimmed.matchAll(TRAILING_NUMBER_BLOB_RE)];
  if (matches.length === 0) return null;
  return parsePowerDetailsInteger(matches[matches.length - 1]![1]!);
}

function splitLabelValue(line: string): { label: string; valuePart: string } {
  const trimmed = line.trim().replace(/[!?|]+$/g, "");
  const colonIdx = trimmed.search(/[:：]/);
  if (colonIdx >= 0) {
    return {
      label: trimmed.slice(0, colonIdx).trim(),
      valuePart: normalizePowerDetailsNumberBlob(trimmed.slice(colonIdx + 1)),
    };
  }
  const matches = [...trimmed.matchAll(TRAILING_NUMBER_BLOB_RE)];
  if (matches.length === 0) {
    return { label: trimmed, valuePart: "" };
  }
  const last = matches[matches.length - 1]!;
  const index = last.index ?? trimmed.lastIndexOf(last[1]!);
  if (index <= 0) {
    return { label: trimmed, valuePart: last[1]! };
  }
  return {
    label: trimmed.slice(0, index).trim(),
    valuePart: normalizePowerDetailsNumberBlob(last[1]!),
  };
}

function candidateDigitRepairs(value: number): number[] {
  const digits = String(value);
  const out = new Set<number>();

  const add = (nextDigits: string) => {
    if (!nextDigits || nextDigits.startsWith("0")) return;
    const nextValue = Number.parseInt(nextDigits, 10);
    if (Number.isFinite(nextValue) && nextValue !== value) out.add(nextValue);
  };

  const commaStripped = stripOcrCommaSevens(digits);
  if (commaStripped) add(commaStripped);

  const swapsAt = (input: string, index: number): string[] => {
    const ch = input[index]!;
    const variants: string[] = [];
    for (const [from, to] of DIGIT_CONFUSIONS) {
      if (ch !== from) continue;
      variants.push(`${input.slice(0, index)}${to}${input.slice(index + 1)}`);
    }
    return variants;
  };

  for (let i = 0; i < digits.length; i += 1) {
    for (const once of swapsAt(digits, i)) {
      add(once);
      for (let j = 0; j < once.length; j += 1) {
        if (j === i) continue;
        for (const twice of swapsAt(once, j)) {
          add(twice);
        }
      }
    }
    add(`${digits.slice(0, i)}${digits.slice(i + 1)}`);
  }

  // OCR sometimes drops a real `7` (85%95'832 → 8595832 instead of 85795832).
  if (digits.length >= 6 && digits.length <= 8) {
    for (let i = 1; i < digits.length; i += 1) {
      add(`${digits.slice(0, i)}7${digits.slice(i)}`);
    }
  }

  // Explicitly keep deletions down to typical THP component lengths (7–9 digits).
  const deleteTowardLength = (input: string, targetLen: number) => {
    if (input.length <= targetLen) return;
    const drop = input.length - targetLen;
    if (drop === 1) {
      for (let i = 0; i < input.length; i += 1) {
        add(`${input.slice(0, i)}${input.slice(i + 1)}`);
      }
      return;
    }
    if (drop === 2) {
      for (let i = 0; i < input.length; i += 1) {
        for (let j = i + 1; j < input.length; j += 1) {
          add(
            `${input.slice(0, i)}${input.slice(i + 1, j)}${input.slice(j + 1)}`,
          );
        }
      }
    }
  };

  for (const [from, to] of PREFIX_CONFUSIONS) {
    if (!digits.startsWith(from)) continue;
    const repaired = `${to}${digits.slice(from.length)}`;
    add(repaired);
    // `12/051%7,077` → prefix 12→7 leaves `70517077`; trim the extra OCR digit.
    for (const targetLen of [7, 8, 9]) {
      deleteTowardLength(repaired, targetLen);
    }
  }

  for (const targetLen of [7, 8, 9]) {
    deleteTowardLength(digits, targetLen);
  }

  const score = (candidate: number): number => {
    const text = String(candidate);
    let rank = Math.abs(text.length - digits.length) * 10;
    for (const [from, to] of PREFIX_CONFUSIONS) {
      if (!digits.startsWith(from)) continue;
      const repaired = `${to}${digits.slice(from.length)}`;
      if (text === repaired) {
        rank -= 100;
        break;
      }
      // Keep prefix+trim candidates (`70517077` → `7051707`) inside the
      // top-200 cut; same-length digit swaps otherwise flood the ranking.
      if (repaired.length === text.length + 1) {
        let trimmed = false;
        for (let i = 0; i < repaired.length; i += 1) {
          if (`${repaired.slice(0, i)}${repaired.slice(i + 1)}` === text) {
            rank -= 90;
            trimmed = true;
            break;
          }
        }
        if (trimmed) break;
      }
    }
    if (text.length >= 7 && text.length <= 9) rank -= 15;
    return rank;
  };

  return [...out].sort((a, b) => score(a) - score(b) || a - b).slice(0, 200);
}

function repairEditCost(from: number, to: number): number {
  if (from === to) return 0;
  const fromDigits = String(from);
  const toDigits = String(to);

  for (const [prefix, replacement] of PREFIX_CONFUSIONS) {
    if (!fromDigits.startsWith(prefix)) continue;
    const afterPrefix = `${replacement}${fromDigits.slice(prefix.length)}`;
    if (toDigits === afterPrefix) return 1;
    // Prefix repair + one deletion (extra separator digit after 12→7).
    if (afterPrefix.length === toDigits.length + 1) {
      for (let i = 0; i < afterPrefix.length; i += 1) {
        if (
          `${afterPrefix.slice(0, i)}${afterPrefix.slice(i + 1)}` === toDigits
        ) {
          return i === 0 ? 4 : 2;
        }
      }
    }
  }
  if (fromDigits.length === toDigits.length + 1) {
    for (let i = 0; i < fromDigits.length; i += 1) {
      if (`${fromDigits.slice(0, i)}${fromDigits.slice(i + 1)}` === toDigits) {
        // Prefer dropping an interior/trailing glyph over the leading digit.
        return i === 0 ? 4 : 1;
      }
    }
  }
  if (toDigits.length === fromDigits.length + 1) {
    for (let i = 0; i < toDigits.length; i += 1) {
      if (
        toDigits[i] === "7" &&
        `${toDigits.slice(0, i)}${toDigits.slice(i + 1)}` === fromDigits
      ) {
        return 1;
      }
    }
  }
  if (fromDigits.length === toDigits.length + 2) {
    for (let i = 0; i < fromDigits.length; i += 1) {
      for (let j = i + 1; j < fromDigits.length; j += 1) {
        if (
          `${fromDigits.slice(0, i)}${fromDigits.slice(i + 1, j)}${fromDigits.slice(j + 1)}` ===
          toDigits
        ) {
          return i === 0 ? 5 : 2;
        }
      }
    }
  }
  if (fromDigits.length === toDigits.length) {
    let diffs = 0;
    for (let i = 0; i < fromDigits.length; i += 1) {
      if (fromDigits[i] === toDigits[i]) continue;
      const pairOk = DIGIT_CONFUSIONS.some(
        ([a, b]) =>
          (fromDigits[i] === a && toDigits[i] === b) ||
          (fromDigits[i] === b && toDigits[i] === a),
      );
      if (!pairOk) return 50;
      diffs += 1;
    }
    return diffs;
  }
  return 50;
}

function isDigitSubsequence(stub: string, full: string): boolean {
  if (!stub) return true;
  let i = 0;
  for (const ch of full) {
    if (ch === stub[i]) i += 1;
    if (i >= stub.length) return true;
  }
  return false;
}

function longestCommonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** Higher is better: prefer deleting interior OCR glyphs over trailing/leading. */
function lengthReduceQuality(from: number, to: number): number {
  const a = String(from);
  const b = String(to);
  if (a.length <= b.length) return longestCommonPrefixLength(a, b);
  if (a[0] !== b[0]) return 0;
  const drop = a.length - b.length;
  if (drop === 1) {
    for (let i = 0; i < a.length; i += 1) {
      if (`${a.slice(0, i)}${a.slice(i + 1)}` === b) {
        return (
          Math.min(i, a.length - 1 - i) * 10 +
          (i > 0 && i < a.length - 1 ? 5 : 0)
        );
      }
    }
  }
  if (drop === 2) {
    let best = 0;
    for (let i = 0; i < a.length; i += 1) {
      for (let j = i + 1; j < a.length; j += 1) {
        if (
          `${a.slice(0, i)}${a.slice(i + 1, j)}${a.slice(j + 1)}` !== b
        ) {
          continue;
        }
        const score =
          Math.min(i, a.length - 1 - i) + Math.min(j, a.length - 1 - j);
        best = Math.max(best, score * 10);
      }
    }
    return best;
  }
  return longestCommonPrefixLength(a, b);
}

function minLenForKey(key: ThpBreakdownKey): number {
  return key === "heroLevel" ||
    key === "decorationsAndBuildings" ||
    key === "gear"
    ? 7
    : 6;
}

function maxLenForKey(key: ThpBreakdownKey): number {
  return key === "heroLevel" ||
    key === "decorationsAndBuildings" ||
    key === "gear"
    ? 8
    : 7;
}

function ocrSuspicion(key: ThpBreakdownKey, value: number): number {
  const digits = String(Math.trunc(value));
  let score = 0;
  if (PREFIX_CONFUSIONS.some(([prefix]) => digits.startsWith(prefix))) score += 10;
  // Typical component widths at mid/high power: level/deco/gear = 8, others = 7.
  const expectedLen = maxLenForKey(key);
  if (digits.length > expectedLen) score += 8;
  if (digits.length < expectedLen) score += 8;
  if (digits.length > 9) score += 4;
  if (key === "wallOfHonor") score += 4;
  return score;
}

function optionAllowedForKey(
  key: ThpBreakdownKey,
  original: number,
  option: number,
): boolean {
  if (option === original) return true;
  // Stable OCR rows should not absorb leftover gap via coincidental digit swaps.
  if (ocrSuspicion(key, original) === 0) return false;

  const fromText = String(original);
  const toText = String(option);
  const cost = repairEditCost(original, option);
  if (cost > 2) return false;

  const maxLen = maxLenForKey(key);
  if (
    PREFIX_CONFUSIONS.some(([prefix, replacement]) => {
      if (!fromText.startsWith(prefix)) return false;
      const afterPrefix = `${replacement}${fromText.slice(prefix.length)}`;
      if (toText === afterPrefix) return true;
      // Prefix 12→7 plus dropping one leftover OCR digit toward expected width.
      if (
        afterPrefix.length === toText.length + 1 &&
        toText.length >= minLenForKey(key) &&
        toText.length <= maxLen
      ) {
        for (let i = 0; i < afterPrefix.length; i += 1) {
          if (
            `${afterPrefix.slice(0, i)}${afterPrefix.slice(i + 1)}` === toText
          ) {
            return true;
          }
        }
      }
      return false;
    })
  ) {
    return true;
  }

  // Oversized OCR blobs: only same-leading length reductions.
  if (fromText.length > maxLen) {
    return (
      toText.length < fromText.length &&
      toText.length >= minLenForKey(key) &&
      toText.length <= maxLen &&
      toText[0] === fromText[0]
    );
  }

  // Exactly one digit short: only allow single `7` insertions to expected width.
  if (fromText.length === maxLen - 1) {
    if (toText.length !== maxLen || cost !== 1) return false;
    for (let i = 0; i < toText.length; i += 1) {
      if (
        toText[i] === "7" &&
        `${toText.slice(0, i)}${toText.slice(i + 1)}` === fromText
      ) {
        return true;
      }
    }
    return false;
  }

  // Other undersized OCR blobs: allow cost≤2 edits toward expected width.
  if (fromText.length < maxLen) {
    return (
      cost <= 2 &&
      toText.length >= minLenForKey(key) &&
      toText.length <= maxLen
    );
  }
  if (toText.length === fromText.length) return cost <= 2;
  return (
    toText.length < fromText.length &&
    toText.length >= minLenForKey(key) &&
    toText.length <= maxLen &&
    toText[0] === fromText[0]
  );
}

/** Prefer fixing rows where crossed `7`s are commonly misread. */
function isPlausibleComponent(value: number, heroPowerTotal: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  return value <= heroPowerTotal;
}

/** OCR sometimes returns stub remnants (`40200`) that cannot be digit-edited back. */
function isDestroyedComponent(value: number, heroPowerTotal: number): boolean {
  if (heroPowerTotal < 10_000_000) return false;
  return String(Math.trunc(value)).length <= 5;
}

/**
 * When the header total disagrees with the component sum, search repairs per
 * trusted row for an exact sum match. Implausible OCR stubs (e.g. wall read as
 * `40200`) are deferred and filled from the remainder.
 */
export function reconcileBreakdownToTotal(
  breakdown: ThpBreakdown,
  heroPowerTotal: number,
): ThpBreakdown {
  if (sumThpBreakdown(breakdown) === heroPowerTotal) {
    return breakdown;
  }
  const originalBreakdown: ThpBreakdown = { ...breakdown };

  const trustedKeys: ThpBreakdownKey[] = [];
  const deferredKeys: ThpBreakdownKey[] = [];
  const optionsByKey = new Map<ThpBreakdownKey, number[]>();
  const healthyByKey = new Map<ThpBreakdownKey, number[]>();
  const currentSum = sumThpBreakdown(breakdown);
  const gap = currentSum - heroPowerTotal;

  for (const key of THP_BREAKDOWN_KEYS) {
    const allOptions = Array.from(
      new Set([breakdown[key], ...candidateDigitRepairs(breakdown[key])]),
    ).filter((value) => isPlausibleComponent(value, heroPowerTotal));
    const healthyOptions = allOptions.filter(
      (value) =>
        !isDestroyedComponent(value, heroPowerTotal) &&
        optionAllowedForKey(key, breakdown[key], value),
    );

    // Force repair of clearly mangled OCR blobs: drop the raw value when a
    // constrained alternative exists (leading 12→7, over/undersized digit stubs).
    const forcedOptions = (() => {
      const original = breakdown[key];
      const text = String(original);
      const maxLen = maxLenForKey(key);
      const hasAlt = healthyOptions.some((value) => value !== original);
      if (!hasAlt) return healthyOptions;
      // Prefer prefix 12→7 (and prefix+trim) over generic length reduction.
      if (PREFIX_CONFUSIONS.some(([prefix]) => text.startsWith(prefix))) {
        const prefixHits = healthyOptions.filter((value) => {
          const to = String(value);
          return PREFIX_CONFUSIONS.some(([prefix, replacement]) => {
            if (!text.startsWith(prefix)) return false;
            const afterPrefix = `${replacement}${text.slice(prefix.length)}`;
            if (to === afterPrefix) return true;
            if (afterPrefix.length !== to.length + 1) return false;
            for (let i = 0; i < afterPrefix.length; i += 1) {
              if (
                `${afterPrefix.slice(0, i)}${afterPrefix.slice(i + 1)}` === to
              ) {
                return true;
              }
            }
            return false;
          });
        });
        if (prefixHits.length > 0) {
          // Prefer repairs that land at the expected component width
          // (`12…077` → `7051707`, not the intermediate `70517077`).
          const atExpectedWidth = prefixHits.filter(
            (value) => String(value).length <= maxLen,
          );
          return atExpectedWidth.length > 0 ? atExpectedWidth : prefixHits;
        }
      }
      if (text.length > maxLen) {
        return healthyOptions.filter((value) => value !== original);
      }
      // Exactly one digit short (often a dropped `7`) — force a lengthening repair.
      if (text.length === maxLen - 1) {
        return healthyOptions.filter((value) => value !== original);
      }
      return healthyOptions;
    })();

    healthyByKey.set(key, forcedOptions);

    if (forcedOptions.length > 0) {
      const ranked = [...forcedOptions].sort(
        (a, b) =>
          repairEditCost(breakdown[key], a) -
            repairEditCost(breakdown[key], b) ||
          Math.abs(a - breakdown[key]) - Math.abs(b - breakdown[key]) ||
          a - b,
      );
      const picked: number[] = [];
      const pushUnique = (value: number) => {
        if (!picked.includes(value)) picked.push(value);
      };

      // Always keep the single-key gap closer when it is a valid repair.
      const gapCloser = breakdown[key] - gap;
      if (forcedOptions.includes(gapCloser)) {
        pushUnique(gapCloser);
      }

      for (const value of ranked) {
        const from = String(breakdown[key]);
        const to = String(value);
        if (
          PREFIX_CONFUSIONS.some(([prefix, replacement]) => {
            if (!from.startsWith(prefix)) return false;
            const afterPrefix = `${replacement}${from.slice(prefix.length)}`;
            if (to === afterPrefix) return true;
            if (afterPrefix.length !== to.length + 1) return false;
            for (let i = 0; i < afterPrefix.length; i += 1) {
              if (
                `${afterPrefix.slice(0, i)}${afterPrefix.slice(i + 1)}` === to
              ) {
                return true;
              }
            }
            return false;
          })
        ) {
          pushUnique(value);
        }
      }
      for (const editCost of [0, 1, 2]) {
        let taken = 0;
        for (const value of ranked) {
          if (repairEditCost(breakdown[key], value) !== editCost) continue;
          pushUnique(value);
          taken += 1;
          if (taken >= 8) break;
        }
      }
      // Cost-2 swaps that introduce additional 7 glyphs (common OCR miss).
      // Prefer more new 7s, then nearer values, so truncation keeps 4502300→4702700.
      const sevenUp = ranked
        .filter((value) => {
          if (repairEditCost(breakdown[key], value) !== 2) return false;
          const fromSevens = String(breakdown[key]).split("7").length - 1;
          const toSevens = String(value).split("7").length - 1;
          return toSevens > fromSevens;
        })
        .sort((a, b) => {
          const aSevens = String(a).split("7").length - 1;
          const bSevens = String(b).split("7").length - 1;
          return (
            bSevens - aSevens ||
            Math.abs(a - breakdown[key]) - Math.abs(b - breakdown[key])
          );
        });
      for (const value of sevenUp.slice(0, 12)) {
        pushUnique(value);
      }

      // Keep every same-length cost-1/2 confusion swap — bounded and high-signal.
      for (const value of ranked) {
        const cost = repairEditCost(breakdown[key], value);
        if (
          cost >= 1 &&
          cost <= 2 &&
          String(value).length === String(breakdown[key]).length
        ) {
          pushUnique(value);
        }
      }

      // Length-reducing repairs (extra OCR digits) with the same leading digit.
      for (const value of ranked) {
        const cost = repairEditCost(breakdown[key], value);
        if (cost > 2) continue;
        const fromText = String(breakdown[key]);
        const toText = String(value);
        if (toText.length >= fromText.length) continue;
        if (toText[0] !== fromText[0]) continue;
        if (toText.length < 7 || toText.length > 9) continue;
        pushUnique(value);
      }

      optionsByKey.set(key, picked.slice(0, 64));
      trustedKeys.push(key);
      continue;
    }

    if (isDestroyedComponent(breakdown[key], heroPowerTotal)) {
      optionsByKey.set(key, []);
      deferredKeys.push(key);
      continue;
    }

    optionsByKey.set(key, allOptions.slice(0, 10));
    if (allOptions.length === 0) {
      deferredKeys.push(key);
    } else {
      trustedKeys.push(key);
    }
  }

  if (deferredKeys.length > 1) {
    return breakdown;
  }

  // Apply unique forced repairs (e.g. only 12→7 remains for hero tier).
  let working: ThpBreakdown = { ...breakdown };
  for (const key of trustedKeys) {
    const options = healthyByKey.get(key) ?? [];
    if (options.length === 1 && options[0] !== working[key]) {
      working = { ...working, [key]: options[0]! };
    }
  }
  if (sumThpBreakdown(working) === heroPowerTotal) {
    return working;
  }
  const workingGap = sumThpBreakdown(working) - heroPowerTotal;

  // Fast path: one trusted row accounts for the whole gap.
  if (deferredKeys.length === 0) {
    let bestSingle: {
      key: ThpBreakdownKey;
      option: number;
      cost: number;
      suspicion: number;
      quality: number;
    } | null = null;
    for (const key of trustedKeys) {
      const options = healthyByKey.get(key) ?? optionsByKey.get(key) ?? [];
      for (const option of options) {
        if (working[key] - option !== workingGap) continue;
        const cost = repairEditCost(breakdown[key], option);
        const suspicion = ocrSuspicion(key, breakdown[key]);
        const quality = lengthReduceQuality(breakdown[key], option);
        if (bestSingle) {
          if (cost > bestSingle.cost) continue;
          if (cost === bestSingle.cost && suspicion < bestSingle.suspicion) {
            continue;
          }
          if (
            cost === bestSingle.cost &&
            suspicion === bestSingle.suspicion &&
            quality <= bestSingle.quality
          ) {
            continue;
          }
        }
        bestSingle = { key, option, cost, suspicion, quality };
      }
    }
    if (bestSingle) {
      return { ...working, [bestSingle.key]: bestSingle.option };
    }

    // Two-key search: prefer pairs that touch OCR-suspicious rows.
    let bestPair: { values: ThpBreakdown; cost: number; suspicion: number } | null =
      null;
    for (let i = 0; i < trustedKeys.length; i += 1) {
      const keyA = trustedKeys[i]!;
      const optionsA = healthyByKey.get(keyA) ?? [];
      for (let j = i + 1; j < trustedKeys.length; j += 1) {
        const keyB = trustedKeys[j]!;
        const optionsB = healthyByKey.get(keyB) ?? [];
        const pairSuspicion =
          ocrSuspicion(keyA, breakdown[keyA]) +
          ocrSuspicion(keyB, breakdown[keyB]);
        for (const optA of optionsA) {
          for (const optB of optionsB) {
            if (working[keyA] - optA + (working[keyB] - optB) !== workingGap) {
              continue;
            }
            const cost =
              repairEditCost(breakdown[keyA], optA) +
              repairEditCost(breakdown[keyB], optB);
            if (
              bestPair &&
              (cost > bestPair.cost ||
                (cost === bestPair.cost &&
                  pairSuspicion <= bestPair.suspicion))
            ) {
              continue;
            }
            bestPair = {
              cost,
              suspicion: pairSuspicion,
              values: { ...working, [keyA]: optA, [keyB]: optB },
            };
          }
        }
      }
    }
    if (bestPair) return bestPair.values;
  }

  // Keep deferred/MITM search aligned with any unique forced repairs.
  const baseline = working;

  if (deferredKeys.length === 1) {
    const deferredKey = deferredKeys[0]!;
    const stub = originalBreakdown[deferredKey];
    const variableKeys = trustedKeys.filter((key) => {
      const options = healthyByKey.get(key) ?? [];
      return options.length > 1 || baseline[key] !== originalBreakdown[key];
    });
    const lockedKeys = trustedKeys.filter((key) => !variableKeys.includes(key));
    const lockedSum = lockedKeys.reduce((sum, key) => sum + baseline[key], 0);

    // Soft prior from mid/high-power samples (~2.9% of Hero Power). Biases
    // destroyed Wall-of-Honor remainder search only — not a hard game rule.
    const expectedWall = heroPowerTotal * 0.029;
    let bestDeferred: { values: ThpBreakdown; score: number } | null = null;

    const search = (
      index: number,
      partialSum: number,
      partialValues: Partial<ThpBreakdown>,
      partialScore: number,
    ) => {
      if (index >= variableKeys.length) {
        const inferred = heroPowerTotal - partialSum;
        if (
          !isPlausibleComponent(inferred, heroPowerTotal) ||
          isDestroyedComponent(inferred, heroPowerTotal)
        ) {
          return;
        }
        const inferredDigits = String(inferred);
        const stubDigits = String(stub).replace(/\D/g, "");
        if (
          stubDigits.length >= 3 &&
          !isDigitSubsequence(stubDigits, inferredDigits)
        ) {
          return;
        }
        let score = partialScore;
        if (inferredDigits[0] === stubDigits[0]) score += 40;
        if (inferredDigits.length >= 7 && inferredDigits.length <= 8) score += 20;
        // Destroyed walls often lost crossed `7` glyphs — prefer recovering them.
        score += (inferredDigits.split("7").length - 1) * 25;
        score -= Math.abs(inferred - expectedWall) / 50_000;
        if (bestDeferred && score <= bestDeferred.score) return;
        bestDeferred = {
          score,
          values: {
            ...baseline,
            ...partialValues,
            [deferredKey]: inferred,
          } as ThpBreakdown,
        };
        return;
      }

      const key = variableKeys[index]!;
      const options = healthyByKey.get(key) ?? [baseline[key]];
      for (const option of options) {
        const nextSum = partialSum + option;
        if (nextSum >= heroPowerTotal) continue;
        search(
          index + 1,
          nextSum,
          { ...partialValues, [key]: option },
          partialScore +
            lengthReduceQuality(originalBreakdown[key], option) -
            repairEditCost(originalBreakdown[key], option) * 3,
        );
      }
    };

    search(0, lockedSum, {}, 0);
    const deferredHit = bestDeferred as {
      values: ThpBreakdown;
      score: number;
    } | null;
    if (deferredHit) return deferredHit.values;
  }

  breakdown = baseline;

  type Half = { sum: number; cost: number; values: Partial<ThpBreakdown> };

  const enumerate = (keys: ThpBreakdownKey[]): Half[] => {
    let states: Half[] = [{ sum: 0, cost: 0, values: {} }];
    for (const key of keys) {
      const options = optionsByKey.get(key) ?? [];
      const next: Half[] = [];
      for (const state of states) {
        for (const option of options) {
          const sum = state.sum + option;
          if (sum > heroPowerTotal) continue;
          next.push({
            sum,
            cost:
              state.cost +
              repairEditCost(breakdown[key], option) -
              lengthReduceQuality(breakdown[key], option) * 0.01,
            values: { ...state.values, [key]: option },
          });
        }
      }
      states = next;
      if (states.length === 0) return [];
    }
    return states;
  };

  const mid = Math.ceil(trustedKeys.length / 2);
  const left = enumerate(trustedKeys.slice(0, mid));
  const right = enumerate(trustedKeys.slice(mid));
  if (left.length === 0 || (trustedKeys.length > mid && right.length === 0)) {
    return breakdown;
  }

  const rightBySum = new Map<number, Half[]>();
  for (const state of right.length > 0 ? right : [{ sum: 0, cost: 0, values: {} }]) {
    const bucket = rightBySum.get(state.sum) ?? [];
    bucket.push(state);
    rightBySum.set(state.sum, bucket);
  }

  let best: { values: ThpBreakdown; cost: number } | null = null;

  for (const leftState of left) {
    if (deferredKeys.length === 1) {
      // right fills trusted remainder; deferred consumes leftover.
      for (const [rightSum, rightStates] of rightBySum) {
        const inferred = heroPowerTotal - leftState.sum - rightSum;
        if (
          !isPlausibleComponent(inferred, heroPowerTotal) ||
          isDestroyedComponent(inferred, heroPowerTotal)
        ) {
          continue;
        }
        for (const rightState of rightStates) {
          const deferredKey = deferredKeys[0]!;
          const stub = working[deferredKey] ?? breakdown[deferredKey];
          const inferredDigits = String(inferred);
          const stubDigits = String(stub);
          let inferredBonus = 0;
          if (inferredDigits[0] === stubDigits[0]) inferredBonus += 4;
          if (inferredDigits.length >= 7 && inferredDigits.length <= 8) {
            inferredBonus += 2;
          }
          const cost =
            leftState.cost + rightState.cost + 5 - inferredBonus;
          if (best && cost >= best.cost) continue;
          best = {
            cost,
            values: {
              ...leftState.values,
              ...rightState.values,
              [deferredKey]: inferred,
            } as ThpBreakdown,
          };
        }
      }
      continue;
    }

    const need = heroPowerTotal - leftState.sum;
    const rightStates = rightBySum.get(need);
    if (!rightStates) continue;
    for (const rightState of rightStates) {
      const cost = leftState.cost + rightState.cost;
      if (best && cost >= best.cost) continue;
      best = {
        cost,
        values: {
          ...leftState.values,
          ...rightState.values,
        } as ThpBreakdown,
      };
      if (cost === 0) return best.values;
    }
  }

  return best?.values ?? breakdown;
}

/**
 * Join label-only lines with the following value line
 * (e.g. "Decorations & Building" + "Stats 37,282,702").
 */
export function coalescePowerDetailsLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (
      (SECTION_STOP_RE.test(line) || SECTION_STOP_FUZZY_RE.test(line)) &&
      !HERO_POWER_HEADER_RE.test(line)
    ) {
      break;
    }

    const { label, valuePart } = splitLabelValue(line);
    const parsedVal = parseIntegerToken(valuePart) ?? extractTrailingNumber(line);
    const hasValue = parsedVal != null && parsedVal >= 10_000;
    const key = matchThpLabel(label);

    if (key && !hasValue && i + 1 < lines.length) {
      const next = lines[i + 1]!.replace(/\s+/g, " ").trim();
      if (SECTION_STOP_RE.test(next) || SECTION_STOP_FUZZY_RE.test(next)) {
        out.push(line);
        break;
      }
      const merged = `${line} ${next}`;
      if (extractTrailingNumber(merged) != null) {
        out.push(merged);
        i += 1;
        continue;
      }
    }

    out.push(line);
  }
  return out;
}

/**
 * If exactly one breakdown row is missing and the header total is known, fill it.
 */
function fillMissingFromTotal(
  breakdown: Partial<ThpBreakdown>,
  heroPowerTotal: number,
): Partial<ThpBreakdown> {
  const present = THP_BREAKDOWN_KEYS.filter(
    (key) => typeof breakdown[key] === "number",
  );
  if (present.length !== THP_BREAKDOWN_KEYS.length - 1) {
    return breakdown;
  }
  const missing = THP_BREAKDOWN_KEYS.find(
    (key) => typeof breakdown[key] !== "number",
  );
  if (!missing) return breakdown;
  const knownSum = present.reduce((sum, key) => sum + breakdown[key]!, 0);
  const inferred = heroPowerTotal - knownSum;
  if (!Number.isFinite(inferred) || inferred <= 0) return breakdown;
  return { ...breakdown, [missing]: inferred };
}

export function parsePowerDetailsLines(lines: string[]): ParsePowerDetailsResult {
  const coalesced = coalescePowerDetailsLines(lines);
  const breakdown: Partial<ThpBreakdown> = {};
  let heroPowerTotal: number | null = null;
  let sawBreakdownRow = false;

  for (let i = 0; i < coalesced.length; i += 1) {
    const line = coalesced[i]!.replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (HERO_POWER_HEADER_RE.test(line) && heroPowerTotal == null) {
      const total = extractTrailingNumber(line);
      if (total != null) {
        heroPowerTotal = total;
      } else if (i + 1 < coalesced.length) {
        // Header label survived but the total landed on the next OCR line.
        const peeked = extractBareHeroPowerTotal(
          coalesced[i + 1]!.replace(/\s+/g, " ").trim(),
        );
        if (peeked != null) heroPowerTotal = peeked;
      }
    }

    // Before any component row, accept a bare total from the header band
    // (dual-pass often emits the number on its own line).
    if (!sawBreakdownRow && heroPowerTotal == null) {
      const bare = extractBareHeroPowerTotal(line);
      if (bare != null) heroPowerTotal = bare;
    }

    const { label: labelPart, valuePart } = splitLabelValue(line);
    const key = matchThpLabel(labelPart);
    if (!key) continue;
    sawBreakdownRow = true;
    const value =
      parsePowerDetailsInteger(valuePart) ?? extractTrailingNumber(line);
    if (value != null && value >= 10_000) {
      breakdown[key] = value;
    }
  }

  if (heroPowerTotal != null) {
    Object.assign(breakdown, fillMissingFromTotal(breakdown, heroPowerTotal));
  }

  const allRowsPresent = THP_BREAKDOWN_KEYS.every(
    (key) => typeof breakdown[key] === "number",
  );
  let complete = false;

  if (allRowsPresent) {
    let full = breakdown as ThpBreakdown;
    if (heroPowerTotal != null) {
      const headerTotal = heroPowerTotal;
      const collapsedHeader = collapseInsertedSeparatorDigit(headerTotal);
      full = Object.fromEntries(
        THP_BREAKDOWN_KEYS.map((key) => [
          key,
          collapseInsertedSeparatorDigit(full[key], headerTotal),
        ]),
      ) as ThpBreakdown;
      const headerInRange =
        headerTotal >= 1_000_000 && headerTotal <= 1_000_000_000;
      const collapsedHeaderInRange =
        collapsedHeader !== headerTotal &&
        collapsedHeader >= 1_000_000 &&
        collapsedHeader <= 1_000_000_000;
      const headerCandidates = Array.from(
        new Set([
          ...(headerInRange ? [headerTotal] : []),
          ...(collapsedHeaderInRange ? [collapsedHeader] : []),
          ...candidateDigitRepairs(headerTotal).filter(
            (value) =>
              value >= 1_000_000 &&
              value <= 1_000_000_000 &&
              repairEditCost(headerTotal, value) <= 2 &&
              // Don't promote a leading-digit swap on the header (1↔7 etc.).
              String(value)[0] === String(headerTotal)[0],
          ),
        ]),
      ).sort((a, b) => {
        // Prefer structured separator collapse over arbitrary digit deletions
        // that happen to reconcile (16416135299 → 164613299, not 161135299).
        const aCollapsed = a === collapsedHeader ? 0 : 1;
        const bCollapsed = b === collapsedHeader ? 0 : 1;
        if (aCollapsed !== bCollapsed) return aCollapsed - bCollapsed;
        return (
          repairEditCost(headerTotal, a) - repairEditCost(headerTotal, b)
        );
      });

      let reconciled: ThpBreakdown | null = null;
      let matchedTotal: number | null = null;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const target of headerCandidates) {
        const attempt = reconcileBreakdownToTotal(full, target);
        if (sumThpBreakdown(attempt) !== target) continue;
        const cost = repairEditCost(headerTotal, target);
        if (cost < bestCost) {
          bestCost = cost;
          reconciled = attempt;
          matchedTotal = target;
          if (cost === 0) break;
        }
      }
      if (reconciled && matchedTotal != null) {
        Object.assign(breakdown, reconciled);
        full = reconciled;
        heroPowerTotal = matchedTotal;
        complete = true;
      }
      // else: keep header total for total-only fallback, but do not mark
      // complete. Callers must not trust an unreconciled component set
      // (resolveProposed prefers breakdown sum over the header).
    }
  }

  return { heroPowerTotal, breakdown, complete };
}

export function toThpBreakdown(
  partial: Partial<ThpBreakdown>,
): ThpBreakdown | null {
  if (!THP_BREAKDOWN_KEYS.every((key) => typeof partial[key] === "number")) {
    return null;
  }
  return partial as ThpBreakdown;
}
