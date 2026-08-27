import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { resolveConductorTopNBoard } from "@/lib/trains/conductor-top-n.shared";
import {
  conductorSpinSource,
  type SpinSource,
} from "@/lib/trains/spin-source.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import {
  resolveLeadTimeInheritedVsBoard,
  resolveVsTopBoardForTrainDate,
  scoreDateDayConfigForTrainDate,
  vsLeaderboardSpinSourceForTrainDate,
  type DayMechanismConfig,
} from "@/lib/trains/vs-score-scope.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export type { DayMechanismConfig };

export function toDayMechanismConfig(day: {
  conductorMechanism?: string | null;
  conductorConfig?: unknown;
  paintTemplate?: string | null;
}): DayMechanismConfig {
  return {
    conductorMechanism: day.conductorMechanism,
    conductorConfig: day.conductorConfig,
    paintTemplate: day.paintTemplate,
  };
}

/** VS score reference calendar date for a train day (T−1−lead). */
export function scoreDateForTrainDay(
  trainDate: string,
  leadDays = 0,
): string {
  return vsScoreReferenceDate(trainDate, leadDays);
}

export type TrainDaySpinSourceInput = {
  trainDate: string;
  trainDay: DayMechanismConfig;
  leadDays?: number;
  scoreDateDay?: DayMechanismConfig | null;
};

/**
 * Conductor spin source with lead-time VS scope inheritance.
 * Pool / PIF paints use the train-day paint; VS leaderboards follow the score
 * reference day's painted rule when lead time shifts the source date.
 */
export function conductorSpinSourceForTrainDay(
  input: TrainDaySpinSourceInput,
): SpinSource {
  const paint = input.trainDay.paintTemplate ?? null;
  const mechanism = effectiveConductorMechanism(
    input.trainDay.conductorMechanism,
    paint as WeekTemplateType | null,
    input.trainDate,
  );
  const base = conductorSpinSource(
    mechanism,
    paint as WeekTemplateType | null,
    input.trainDate,
    input.trainDay.conductorConfig,
  );
  const vsScope = vsLeaderboardSpinSourceForTrainDate(input);
  if (vsScope && base?.kind === "vs_leaderboard") {
    return vsScope;
  }
  return base;
}

/** Top board for nomination / succession when lead time inherits VS scope. */
export function resolveNominationTopBoard(input: TrainDaySpinSourceInput) {
  const vsBoard = resolveVsTopBoardForTrainDate(input);
  if (vsBoard) return vsBoard;

  const inherited = resolveLeadTimeInheritedVsBoard(input);
  if (inherited) return inherited;

  const mechanism = effectiveConductorMechanism(
    input.trainDay.conductorMechanism,
    input.trainDay.paintTemplate as WeekTemplateType | null,
    input.trainDate,
  );
  return resolveConductorTopNBoard(
    mechanism,
    input.trainDay.conductorConfig,
  );
}

/** Score reference day's painted rule from an in-memory week/month config list. */
export function scoreDateDayFromDayConfigs(
  trainDate: string,
  leadDays: number,
  dayConfigs: ReadonlyArray<
    { date: string; paintTemplate?: string | null } & DayMechanismConfig
  >,
): DayMechanismConfig | null {
  return scoreDateDayConfigForTrainDate(trainDate, leadDays, dayConfigs);
}
