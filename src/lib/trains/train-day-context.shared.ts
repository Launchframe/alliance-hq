import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  spinSourceForConductorRule,
  type SpinSource,
} from "@/lib/trains/rules/derive.shared";
import {
  resolveLeadTimeInheritedVsBoard,
  resolveVsBoardForTrainDate,
} from "@/lib/trains/vs-score-scope.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

/** VS score reference calendar date for a train day (T−1−lead). */
export function scoreDateForTrainDay(
  trainDate: string,
  leadDays = 0,
): string {
  return vsScoreReferenceDate(trainDate, leadDays);
}

export type TrainDaySpinSourceInput = {
  trainRule: ConductorRule | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
};

/**
 * Conductor spin source with lead-time VS scope inheritance. Pools and Price
 * Is Freight use the train day's own rule; VS boards follow the scope painted
 * on the day the scores came from.
 */
export function conductorSpinSourceForTrainDay(
  input: TrainDaySpinSourceInput,
): SpinSource {
  const base = spinSourceForConductorRule(input.trainRule);
  if (base?.kind !== "vs_leaderboard") return base;
  const board = resolveVsBoardForTrainDate(input);
  return board ? { kind: "vs_leaderboard", topN: board.topN } : base;
}

export type NominationTopBoard = { kind: "vs" | "vr"; topN: number };

/** Top board for nomination / succession, including lead-time inheritance. */
export function resolveNominationTopBoard(
  input: TrainDaySpinSourceInput,
): NominationTopBoard | null {
  const vsBoard = resolveVsBoardForTrainDate(input);
  if (vsBoard) return { kind: "vs", topN: vsBoard.topN };

  const inherited = resolveLeadTimeInheritedVsBoard(input);
  if (inherited) return { kind: "vs", topN: inherited.topN };

  if (input.trainRule?.kind === "vr_top_n") {
    return { kind: "vr", topN: input.trainRule.topN };
  }
  return null;
}

/** Score reference day's rule from an in-memory week/month config list. */
export function scoreDayRuleFromDayConfigs(
  trainDate: string,
  leadDays: number,
  dayConfigs: ReadonlyArray<{
    date: string;
    conductorRule: ConductorRule | null;
  }>,
): ConductorRule | null {
  if (leadDays <= 0) return null;
  const scoreDate = vsScoreReferenceDate(trainDate, leadDays);
  return dayConfigs.find((day) => day.date === scoreDate)?.conductorRule ?? null;
}
