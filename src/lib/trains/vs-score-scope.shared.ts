import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  conductorRuleNeedsWheel,
  conductorRuleUsesVsScores,
} from "@/lib/trains/rules/derive.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

/**
 * Lead time moves a train day's scores to an earlier calendar day. When it
 * does, the VS scope follows the day the scores came from: a Wednesday train
 * reading Monday's board uses Monday's painted scope, not Wednesday's.
 */

export type VsBoard = { topN: number };

function vsBoard(rule: ConductorRule | null | undefined): VsBoard | null {
  return rule?.kind === "vs_top_n" ? { topN: rule.topN } : null;
}

export function scoreDateForTrainDate(
  trainDate: string,
  leadDays: number,
): string {
  return vsScoreReferenceDate(trainDate, leadDays);
}

/** VS board for a train day, following the score day's scope under lead time. */
export function resolveVsBoardForTrainDate(input: {
  trainRule: ConductorRule | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): VsBoard | null {
  const trainBoard = vsBoard(input.trainRule);
  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0 || !input.scoreDayRule) return trainBoard;

  const scoreBoard = vsBoard(input.scoreDayRule);
  if (trainBoard) return scoreBoard ?? trainBoard;
  return null;
}

/**
 * VS board inherited from the score day when the train day itself carries a
 * non-VS rule — used for labels on off-template days under lead time.
 */
export function resolveLeadTimeInheritedVsBoard(input: {
  trainRule: ConductorRule | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): VsBoard | null {
  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0 || !input.scoreDayRule) return null;
  if (conductorRuleUsesVsScores(input.trainRule)) return null;
  return vsBoard(input.scoreDayRule);
}

/** Effective rule for wheels and labels once lead-time inheritance applies. */
export function effectiveConductorRuleForTrainDate(input: {
  trainRule: ConductorRule | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): ConductorRule | null {
  const board = resolveVsBoardForTrainDate(input);
  if (board && input.trainRule?.kind === "vs_top_n") {
    return { kind: "vs_top_n", topN: board.topN as 1 | 3 | 5 | 10 };
  }
  return input.trainRule;
}

export function canSpinConductorWithLeadScope(input: {
  rule: ConductorRule | null;
  locked: boolean;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): boolean {
  if (input.locked) return false;
  return conductorRuleNeedsWheel(
    effectiveConductorRuleForTrainDate({
      trainRule: input.rule,
      leadDays: input.leadDays,
      scoreDayRule: input.scoreDayRule,
    }),
  );
}

export function vsLeaderboardSpinSourceForTrainDate(input: {
  trainRule: ConductorRule | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): { kind: "vs_leaderboard"; topN: number } | null {
  const board = resolveVsBoardForTrainDate(input);
  return board ? { kind: "vs_leaderboard", topN: board.topN } : null;
}
