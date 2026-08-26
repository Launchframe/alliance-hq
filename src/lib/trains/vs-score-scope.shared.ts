import {
  isAutomaticTopNBoard,
  resolveConductorTopNBoard,
  type ResolvedConductorTopNBoard,
} from "@/lib/trains/conductor-top-n.shared";
import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { mechanismNeedsWheel } from "@/lib/trains/templates";
import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export type DayMechanismConfig = {
  conductorMechanism: string | null | undefined;
  conductorConfig?: unknown;
  paintTemplate?: string | null;
};

/**
 * VS top-N board for wheels and eligibility. When lead time shifts the score
 * source to another calendar day, scope follows that score day's painted rule.
 */
export function resolveVsTopBoardForTrainDate(input: {
  trainDate: string;
  trainDay: DayMechanismConfig;
  leadDays?: number;
  /** Config for the VS score reference date (same week schedule). */
  scoreDateDay?: DayMechanismConfig | null;
}): ResolvedConductorTopNBoard | null {
  const trainBoard = resolveConductorTopNBoard(
    input.trainDay.conductorMechanism,
    input.trainDay.conductorConfig,
  );
  if (trainBoard?.kind !== "vs") return trainBoard;

  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0) return trainBoard;

  if (!input.scoreDateDay) return trainBoard;

  const scoreBoard = resolveConductorTopNBoard(
    input.scoreDateDay.conductorMechanism,
    input.scoreDateDay.conductorConfig,
  );
  return scoreBoard?.kind === "vs" ? scoreBoard : trainBoard;
}

/** VS top board inherited from the score reference day on off-template train days. */
export function resolveLeadTimeInheritedVsBoard(input: {
  trainDay: DayMechanismConfig;
  leadDays?: number;
  scoreDateDay?: DayMechanismConfig | null;
}): ResolvedConductorTopNBoard | null {
  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0 || !input.scoreDateDay) return null;

  const trainBoard = resolveConductorTopNBoard(
    input.trainDay.conductorMechanism,
    input.trainDay.conductorConfig,
  );
  if (trainBoard?.kind === "vs") return null;

  const scoreBoard = resolveConductorTopNBoard(
    input.scoreDateDay.conductorMechanism,
    input.scoreDateDay.conductorConfig,
  );
  return scoreBoard?.kind === "vs" ? scoreBoard : null;
}

export function scoreDateDayConfigForTrainDate(
  trainDate: string,
  leadDays: number,
  dayConfigs: ReadonlyArray<
    { date: string; paintTemplate?: string | null } & DayMechanismConfig
  >,
): DayMechanismConfig | null {
  if (leadDays <= 0) return null;
  const scoreDate = vsScoreReferenceDate(trainDate, leadDays);
  const row = dayConfigs.find((day) => day.date === scoreDate);
  if (!row) return null;
  return {
    conductorMechanism: row.conductorMechanism,
    conductorConfig: row.conductorConfig,
    paintTemplate: row.paintTemplate,
  };
}

/** Conductor mechanism label key for week tiles / spin source when lead time applies. */
export function effectiveVsScopeMechanismForTrainDate(input: {
  trainDate: string;
  trainDay: DayMechanismConfig;
  leadDays?: number;
  scoreDateDay?: DayMechanismConfig | null;
  fallbackMechanism: string;
}): string {
  const board = resolveVsTopBoardForTrainDate(input);
  if (board?.kind === "vs" && (input.leadDays ?? 0) > 0) {
    return board.mechanism;
  }
  const inherited = resolveLeadTimeInheritedVsBoard(input);
  if (inherited?.kind === "vs") {
    return inherited.mechanism;
  }
  return input.fallbackMechanism;
}

export function canSpinConductorWithLeadScope(input: {
  conductorMechanism: string | null | undefined;
  locked: boolean;
  paintTemplate?: WeekTemplateType | null;
  trainDate?: string | null;
  conductorConfig?: unknown;
  leadDays?: number;
  scoreDateDay?: DayMechanismConfig | null;
}): boolean {
  if (input.locked) return false;
  if (input.paintTemplate === "r3_recognition") return false;

  const mechanism = effectiveConductorMechanism(
    input.conductorMechanism,
    input.paintTemplate,
    input.trainDate,
  );
  if (!mechanism) return false;
  if (mechanism === "donations_top") return false;

  const topBoard = resolveVsTopBoardForTrainDate({
    trainDate: input.trainDate ?? "",
    trainDay: {
      conductorMechanism: mechanism,
      conductorConfig: input.conductorConfig,
    },
    leadDays: input.leadDays,
    scoreDateDay: input.scoreDateDay,
  });

  if (isAutomaticTopNBoard(topBoard)) return false;
  if (topBoard) {
    return mechanismNeedsWheel(
      topBoard.mechanism as ConductorMechanismType,
      input.conductorConfig,
    );
  }
  return mechanismNeedsWheel(mechanism, input.conductorConfig);
}

export function vsLeaderboardSpinSourceForTrainDate(input: {
  trainDate: string;
  trainDay: DayMechanismConfig;
  leadDays?: number;
  scoreDateDay?: DayMechanismConfig | null;
}): { kind: "vs_leaderboard"; topN: number } | null {
  const board = resolveVsTopBoardForTrainDate(input);
  if (board?.kind !== "vs") return null;
  return { kind: "vs_leaderboard", topN: board.topN };
}
