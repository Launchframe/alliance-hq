/**
 * Parse OCR text lines from the in-game Power Details screen.
 *
 * Tesseract often turns thousand-separators into apostrophes, dashes, slashes,
 * brackets, or currency glyphs (`85'857244 8!`, `4%,02¥,00`). Value extraction
 * must tolerate that junk and strip to digits. Drone/Building sections are ignored.
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

const HERO_POWER_HEADER_RE = /hero\s*l?\s*powers?/i;
const SECTION_STOP_RE =
  /^(drone\s*power|drone\s*level|skill\s*chip|drone\s*component|building\s*power|buildings?\b)/i;

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

function extractTrailingNumber(line: string): number | null {
  const trimmed = line.trim().replace(/[!?|]+$/g, "");
  const matches = [...trimmed.matchAll(TRAILING_NUMBER_BLOB_RE)];
  if (matches.length === 0) return null;
  return parseIntegerToken(matches[matches.length - 1]![1]!);
}

function splitLabelValue(line: string): { label: string; valuePart: string } {
  const trimmed = line.trim().replace(/[!?|]+$/g, "");
  const colonIdx = trimmed.search(/[:：]/);
  if (colonIdx >= 0) {
    return {
      label: trimmed.slice(0, colonIdx).trim(),
      valuePart: trimmed.slice(colonIdx + 1),
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
    valuePart: last[1]!,
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

  for (const [from, to] of PREFIX_CONFUSIONS) {
    if (!digits.startsWith(from)) continue;
    add(`${to}${digits.slice(from.length)}`);
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
  for (const targetLen of [7, 8, 9]) {
    deleteTowardLength(digits, targetLen);
  }

  const score = (candidate: number): number => {
    const text = String(candidate);
    let rank = Math.abs(text.length - digits.length) * 10;
    for (const [from, to] of PREFIX_CONFUSIONS) {
      if (
        digits.startsWith(from) &&
        text === `${to}${digits.slice(from.length)}`
      ) {
        rank -= 100;
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
    if (
      fromDigits.startsWith(prefix) &&
      toDigits === `${replacement}${fromDigits.slice(prefix.length)}`
    ) {
      return 1;
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

function ocrSuspicion(key: ThpBreakdownKey, value: number): number {
  const digits = String(Math.trunc(value));
  let score = 0;
  if (PREFIX_CONFUSIONS.some(([prefix]) => digits.startsWith(prefix))) score += 10;
  // Typical component widths at mid/high power: level/deco/gear ≤8, others ≤7.
  const maxLen =
    key === "heroLevel" ||
    key === "decorationsAndBuildings" ||
    key === "gear"
      ? 8
      : 7;
  if (digits.length > maxLen) score += 8;
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

  if (
    PREFIX_CONFUSIONS.some(
      ([prefix, replacement]) =>
        fromText.startsWith(prefix) &&
        toText === `${replacement}${fromText.slice(prefix.length)}`,
    )
  ) {
    return true;
  }

  // Oversized OCR blobs: only same-leading length reductions.
  const maxLen =
    key === "heroLevel" ||
    key === "decorationsAndBuildings" ||
    key === "gear"
      ? 8
      : 7;
  if (fromText.length > maxLen) {
    return (
      toText.length < fromText.length &&
      toText.length >= 7 &&
      toText.length <= maxLen &&
      toText[0] === fromText[0]
    );
  }

  if (toText.length === fromText.length) return cost <= 2;
  return (
    toText.length < fromText.length &&
    toText.length >= 7 &&
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
    // constrained alternative exists (leading 12→7, or oversized digit stubs).
    const forcedOptions = (() => {
      const original = breakdown[key];
      const text = String(original);
      const maxLen =
        key === "heroLevel" ||
        key === "decorationsAndBuildings" ||
        key === "gear"
          ? 8
          : 7;
      const hasAlt = healthyOptions.some((value) => value !== original);
      if (!hasAlt) return healthyOptions;
      if (text.length > maxLen) {
        return healthyOptions.filter((value) => value !== original);
      }
      if (PREFIX_CONFUSIONS.some(([prefix]) => text.startsWith(prefix))) {
        const prefixHits = healthyOptions.filter((value) => {
          const to = String(value);
          return PREFIX_CONFUSIONS.some(
            ([prefix, replacement]) =>
              text.startsWith(prefix) &&
              to === `${replacement}${text.slice(prefix.length)}`,
          );
        });
        if (prefixHits.length > 0) return prefixHits;
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
          PREFIX_CONFUSIONS.some(
            ([prefix, replacement]) =>
              from.startsWith(prefix) &&
              to === `${replacement}${from.slice(prefix.length)}`,
          )
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
    if (SECTION_STOP_RE.test(line) && !HERO_POWER_HEADER_RE.test(line)) {
      break;
    }

    const { label, valuePart } = splitLabelValue(line);
    const hasValue =
      parseIntegerToken(valuePart) != null || extractTrailingNumber(line) != null;
    const key = matchThpLabel(label);

    if (key && !hasValue && i + 1 < lines.length) {
      const next = lines[i + 1]!.replace(/\s+/g, " ").trim();
      if (SECTION_STOP_RE.test(next)) {
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

  for (const rawLine of coalesced) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (HERO_POWER_HEADER_RE.test(line) && heroPowerTotal == null) {
      const total = extractTrailingNumber(line);
      if (total != null) heroPowerTotal = total;
    }

    const { label: labelPart, valuePart } = splitLabelValue(line);
    const key = matchThpLabel(labelPart);
    if (!key) continue;
    const value =
      parseIntegerToken(valuePart) ?? extractTrailingNumber(line);
    if (value != null) {
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
      const headerCandidates = Array.from(
        new Set([
          headerTotal,
          ...candidateDigitRepairs(headerTotal).filter(
            (value) =>
              value >= 1_000_000 &&
              value <= 1_000_000_000 &&
              repairEditCost(headerTotal, value) <= 2 &&
              // Don't promote a leading-digit swap on the header (1↔7 etc.).
              String(value)[0] === String(headerTotal)[0],
          ),
        ]),
      ).sort(
        (a, b) =>
          repairEditCost(headerTotal, a) - repairEditCost(headerTotal, b),
      );

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
        // Covers the already-consistent case too: headerCandidates always
        // includes the raw header total at cost 0, tried first, and
        // reconcileBreakdownToTotal short-circuits when the sum already
        // matches — so an exact match never falls through to the `else`.
        Object.assign(breakdown, reconciled);
        full = reconciled;
        heroPowerTotal = matchedTotal;
        complete = true;
      }
      // else: keep header total for total-only fallback, but do not mark
      // complete. Callers must not trust an unreconciled component set
      // (resolveProposed prefers breakdown sum over the header).
    }
    // No Hero Power header: do not treat component-only OCR as submission-
    // ready. Separator noise can glue digits (e.g. gear 133M) with no
    // reconciliation anchor. Expose raw rows for diagnostics only.
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
