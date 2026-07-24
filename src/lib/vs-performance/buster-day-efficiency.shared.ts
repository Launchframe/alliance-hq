/**
 * Pure Buster Day efficiency math (unit-testable without DB).
 *
 * Baseline is non-combat Saturday points (Gold tasks + Gold trucks + 50% Arms Race).
 * Revise `BUSTER_DAY_BASELINE_POINTS` if Ashed’s non-combat values change.
 */

/** Gold tasks 2_025_000 + Gold trucks 1_500_000 + 50% Arms Race 810_000 */
export const BUSTER_DAY_BASELINE_POINTS = 4_335_000;

/** Floor for power-lost denominator so we never divide by literal zero. */
export const BUSTER_DAY_EFFICIENCY_EPSILON = 1e-6;

/** Treat near-zero power loss + near-zero net score as “No engagement”. */
export const BUSTER_DAY_NO_ENGAGEMENT_POWER_M = 1e-6;

export const BUSTER_DAY_KILL_POINTS_PER_KILL_MIN = 33;
export const BUSTER_DAY_KILL_POINTS_PER_KILL_MAX = 165;

export type BusterDayEfficiencyInput = {
  commanderId: string;
  memberName: string;
  ashedMemberId: string | null;
  powerStartM: number | null;
  powerEndM: number | null;
  killsStart: number | null;
  killsEnd: number | null;
  vsScoreSaturday: number | null;
};

export type SerializedBusterDayEfficiencyRow = {
  commanderId: string;
  memberName: string;
  ashedMemberId: string | null;
  powerStartM: number | null;
  powerEndM: number | null;
  powerLostM: number;
  killsStart: number | null;
  killsEnd: number | null;
  killsDelta: number;
  estimatedKillPointsMin: number;
  estimatedKillPointsMax: number;
  vsScoreSaturday: number | null;
  netVsScore: number;
  /** Null when noEngagement — do not display as a numeric ratio. */
  efficiencyRatio: number | null;
  noEngagement: boolean;
};

export function computeBusterDayEfficiencyRow(
  input: BusterDayEfficiencyInput,
): SerializedBusterDayEfficiencyRow {
  const powerStartM = input.powerStartM;
  const powerEndM = input.powerEndM;
  const killsStart = input.killsStart;
  const killsEnd = input.killsEnd;
  const vsScoreSaturday = input.vsScoreSaturday;

  const powerLostM =
    powerStartM != null && powerEndM != null
      ? Math.max(0, powerStartM - powerEndM)
      : 0;
  const killsDelta =
    killsStart != null && killsEnd != null
      ? Math.max(0, killsEnd - killsStart)
      : 0;
  const netVsScore =
    vsScoreSaturday != null
      ? Math.max(0, vsScoreSaturday - BUSTER_DAY_BASELINE_POINTS)
      : 0;

  const noEngagement =
    netVsScore <= BUSTER_DAY_EFFICIENCY_EPSILON &&
    powerLostM <= BUSTER_DAY_NO_ENGAGEMENT_POWER_M;

  const efficiencyRatio = noEngagement
    ? null
    : netVsScore / Math.max(powerLostM, BUSTER_DAY_EFFICIENCY_EPSILON);

  return {
    commanderId: input.commanderId,
    memberName: input.memberName,
    ashedMemberId: input.ashedMemberId,
    powerStartM,
    powerEndM,
    powerLostM,
    killsStart,
    killsEnd,
    killsDelta,
    estimatedKillPointsMin: killsDelta * BUSTER_DAY_KILL_POINTS_PER_KILL_MIN,
    estimatedKillPointsMax: killsDelta * BUSTER_DAY_KILL_POINTS_PER_KILL_MAX,
    vsScoreSaturday,
    netVsScore,
    efficiencyRatio,
    noEngagement,
  };
}

/** Weakest efficiency first; no-engagement rows sink to the bottom. */
export function sortBusterDayEfficiencyRows(
  rows: SerializedBusterDayEfficiencyRow[],
): SerializedBusterDayEfficiencyRow[] {
  return [...rows].sort((a, b) => {
    if (a.noEngagement !== b.noEngagement) {
      return a.noEngagement ? 1 : -1;
    }
    if (a.noEngagement && b.noEngagement) {
      return a.memberName.localeCompare(b.memberName);
    }
    const ar = a.efficiencyRatio ?? Number.POSITIVE_INFINITY;
    const br = b.efficiencyRatio ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return a.memberName.localeCompare(b.memberName);
  });
}

export function computeBusterDayEfficiencyReport(
  inputs: BusterDayEfficiencyInput[],
): SerializedBusterDayEfficiencyRow[] {
  return sortBusterDayEfficiencyRows(
    inputs.map((input) => computeBusterDayEfficiencyRow(input)),
  );
}

/** Absolute calendar-day distance between YYYY-MM-DD strings. */
export function calendarDayDistance(a: string, b: string): number {
  const msA = Date.parse(`${a}T12:00:00.000Z`);
  const msB = Date.parse(`${b}T12:00:00.000Z`);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(Math.round((msA - msB) / 86_400_000));
}

export function pickClosestByCalendarDate<T>(
  items: readonly T[],
  targetDate: string,
  getDate: (item: T) => string | null | undefined,
): T | null {
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const date = getDate(item)?.trim();
    if (!date) continue;
    const dist = calendarDayDistance(date, targetDate);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}
