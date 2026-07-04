/**
 * Season institute building level → base virus resistance (VR).
 * Source: cpt-hedge.com building tables (Virus Research Institute, High-heat
 * Furnace, Curse Research Lab, Optoelectronic Lab, Caffeine Institute, Fungus
 * Institute). Progressions differ by season — do not assume a fixed +250 step.
 */

/** S1 Virus Research Institute / S2 High-heat Furnace (levels 1–30). */
const SEASON_1_AND_2_VR: readonly number[] = [
  100, 200, 300, 400, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750,
  3000, 3400, 3800, 4200, 4600, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500,
  9000, 9500, 10000,
];

/**
 * S3 Curse Research Lab — published table has level 5 = 400 (same as level 4).
 * Levels 6–30 match S1/S2 from 750 upward.
 */
const SEASON_3_VR: readonly number[] = [
  100, 200, 300, 400, 400, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750,
  3000, 3400, 3800, 4200, 4600, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500,
  9000, 9500, 10000,
];

/** S4 Optoelectronic Lab (levels 1–35). */
const SEASON_4_VR: readonly number[] = [
  ...SEASON_1_AND_2_VR,
  10500, 11000, 11500, 12000, 13000,
];

/**
 * S5 Caffeine Institute (levels 1–60), primary Virus Resistance column
 * (servers 69+). Older servers (3–68) use a different ladder from level 37;
 * we track the primary column only for now.
 */
const SEASON_5_VR: readonly number[] = [
  100, 200, 300, 400, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750,
  3000, 3250, 3500, 3750, 4000, 4250, 4500, 4750, 5000, 5250, 5500, 5750, 6000,
  6250, 6500, 6750, 7000, 7250, 7500, 7750, 8000, 8250, 8400, 8550, 8700, 8850,
  9000, 9200, 9400, 9600, 9900, 10200, 10500, 10700, 10900, 11200, 11400, 11600,
  11800, 12000, 12200, 12400, 13300, 18000, 23000, 28000,
];

/** S6 Fungus Institute (levels 1–30). */
const SEASON_6_VR: readonly number[] = [
  250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500,
  6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500,
  12000, 12750, 13500, 14250, 15000,
];

const BY_SEASON: Record<string, readonly number[]> = {
  "1": SEASON_1_AND_2_VR,
  "2": SEASON_1_AND_2_VR,
  "3": SEASON_3_VR,
  "4": SEASON_4_VR,
  "5": SEASON_5_VR,
  "6": SEASON_6_VR,
};

export function seasonNumberFromKey(seasonKey: string): number {
  const n = Number.parseInt(String(seasonKey).trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** VR table for a season key (`"1"`…`"6"`). Unknown seasons use the latest known map. */
export function instituteVrByLevel(seasonKey: string): readonly number[] {
  const n = seasonNumberFromKey(seasonKey);
  return BY_SEASON[String(n)] ?? SEASON_6_VR;
}

export function maxInstituteLevel(seasonKey: string): number {
  return instituteVrByLevel(seasonKey).length;
}

export function minInstituteLevel(): number {
  return 1;
}

export function baseVrForInstituteLevel(
  seasonKey: string,
  instituteLevel: number,
): number | null {
  const table = instituteVrByLevel(seasonKey);
  if (
    !Number.isInteger(instituteLevel) ||
    instituteLevel < 1 ||
    instituteLevel > table.length
  ) {
    return null;
  }
  return table[instituteLevel - 1]!;
}

/**
 * Highest institute level whose VR equals `baseVr`. When a season has duplicate
 * VR values (e.g. S3 levels 4–5), prefer the highest level.
 */
export function instituteLevelForBaseVr(
  seasonKey: string,
  baseVr: number,
): number | null {
  const table = instituteVrByLevel(seasonKey);
  let found: number | null = null;
  for (let i = 0; i < table.length; i++) {
    if (table[i] === baseVr) found = i + 1;
  }
  return found;
}

export function isValidInstituteLevel(
  seasonKey: string,
  instituteLevel: number,
): boolean {
  return baseVrForInstituteLevel(seasonKey, instituteLevel) != null;
}

export function isValidBaseVrForSeason(
  seasonKey: string,
  baseVr: number,
): boolean {
  return instituteLevelForBaseVr(seasonKey, baseVr) != null;
}

export function minBaseVrForSeason(seasonKey: string): number {
  return instituteVrByLevel(seasonKey)[0]!;
}

export function maxBaseVrForSeason(seasonKey: string): number {
  const table = instituteVrByLevel(seasonKey);
  return table[table.length - 1]!;
}

export function nextInstituteLevel(
  seasonKey: string,
  currentLevel: number | null,
): number | null {
  const max = maxInstituteLevel(seasonKey);
  if (currentLevel == null || currentLevel < 1) return 1;
  if (currentLevel >= max) return null;
  return currentLevel + 1;
}

/** Previous institute level (for one-step downgrade floor). */
export function previousInstituteLevel(
  seasonKey: string,
  currentLevel: number,
): number {
  if (currentLevel <= 1) return 1;
  return Math.min(currentLevel - 1, maxInstituteLevel(seasonKey));
}

export type BaseVrValidationResult =
  | { ok: true; instituteLevel: number; baseVr: number }
  | {
      ok: false;
      kind: "out_of_range";
      min: number;
      max: number;
    }
  | {
      ok: false;
      kind: "not_on_ladder";
      lower: number;
      upper: number;
    };

/**
 * Validate a manually entered VR value for a season.
 * - Outside [min, max] (or non-positive): out_of_range
 * - Inside range but not a ladder value: not_on_ladder with nearest neighbors
 */
export function validateBaseVrForSeason(
  seasonKey: string,
  baseVr: number,
): BaseVrValidationResult {
  const min = minBaseVrForSeason(seasonKey);
  const max = maxBaseVrForSeason(seasonKey);

  if (!Number.isFinite(baseVr) || !Number.isInteger(baseVr)) {
    return { ok: false, kind: "out_of_range", min, max };
  }
  if (baseVr < min || baseVr > max || baseVr < 0) {
    return { ok: false, kind: "out_of_range", min, max };
  }

  const level = instituteLevelForBaseVr(seasonKey, baseVr);
  if (level != null) {
    return { ok: true, instituteLevel: level, baseVr };
  }

  const table = instituteVrByLevel(seasonKey);
  let lower = table[0]!;
  let upper = table[table.length - 1]!;
  for (let i = 0; i < table.length; i++) {
    const v = table[i]!;
    if (v < baseVr) lower = v;
    if (v > baseVr) {
      upper = v;
      break;
    }
  }
  return { ok: false, kind: "not_on_ladder", lower, upper };
}

export function formatBaseVrValidationError(
  result: Extract<BaseVrValidationResult, { ok: false }>,
): string {
  if (result.kind === "out_of_range") {
    return `Enter a value between ${result.min} and ${result.max}.`;
  }
  return `Base VR must match an institute level. Nearest valid values: ${result.lower} and ${result.upper}.`;
}

/** Best-effort level for legacy rows that only stored VR. */
export function coerceInstituteLevelFromBaseVr(
  seasonKey: string,
  baseVr: number,
): number {
  const exact = instituteLevelForBaseVr(seasonKey, baseVr);
  if (exact != null) return exact;

  const table = instituteVrByLevel(seasonKey);
  let best = 1;
  for (let i = 0; i < table.length; i++) {
    if (table[i]! <= baseVr) best = i + 1;
  }
  return best;
}
