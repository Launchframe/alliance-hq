import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRuleUsesVsScores } from "@/lib/trains/rules/derive.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

/**
 * Lead time moves a train day's scores to an earlier calendar day — it changes
 * only which date's scores are read, never the board's Top N. The train day's
 * painted rule stays authoritative for scope: a `{vs_top_n, 1}` train rule is
 * Top 1 even when the score day is painted Top 10.
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

/** VS board for a train day — the painted train-day scope, always. */
export function resolveVsBoardForTrainDate(input: {
  trainRule: ConductorRule | null;
}): VsBoard | null {
  return vsBoard(input.trainRule);
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

/** Effective rule for wheels and labels — the painted rule is authoritative. */
export function effectiveConductorRuleForTrainDate(input: {
  trainRule: ConductorRule | null;
}): ConductorRule | null {
  return input.trainRule;
}
