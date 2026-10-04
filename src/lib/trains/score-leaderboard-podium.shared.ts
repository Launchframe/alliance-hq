import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRuleUsesPriceIsFreightRoll } from "@/lib/trains/rules/derive.shared";
import { priorDayVsAppliesForTrainDate } from "@/lib/trains/vs-data-status.shared";

/** Discriminator for score-based rule podiums on the trains dashboard. */
export type ScoreLeaderboardKind = "tpif" | "vs_push" | "donations";

export type ScoreLeaderboardEntry = {
  rank: number;
  memberId: string;
  memberName: string;
  score: number;
  isViewer?: boolean;
};

export type ScoreLeaderboardPayload = {
  kind: ScoreLeaderboardKind;
  trainDate: string;
  /** Prior-day VS recorded date when applicable. */
  scoreDate?: string;
  podium: ScoreLeaderboardEntry[];
  entries: ScoreLeaderboardEntry[];
  /** When true, UI shows an explicit empty state (donations ledger not wired). */
  unavailable?: boolean;
};

export const SCORE_LEADERBOARD_LIST_MAX = 10;

function nativeKindForRule(
  rule: ConductorRule | null | undefined,
): ScoreLeaderboardKind | null {
  if (!rule) return null;
  if (conductorRuleUsesPriceIsFreightRoll(rule)) return "tpif";
  if (rule.kind === "vs_top_n") return "vs_push";
  if (rule.kind === "donations_top") return "donations";
  return null;
}

/**
 * Which score podium a day shows. Under lead time a non-score day can still
 * show the score day's podium, because that is the board its conductor came
 * from.
 */
export function resolveScoreLeaderboardKind(input: {
  rule: ConductorRule | null | undefined;
  trainDate?: string | null;
  leadDays?: number;
  scoreDayRule?: ConductorRule | null;
}): ScoreLeaderboardKind | null {
  const native = nativeKindForRule(input.rule);
  if (native) return native;

  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0 || !input.trainDate || !input.scoreDayRule) {
    return null;
  }
  if (!priorDayVsAppliesForTrainDate(input.trainDate, leadDays)) {
    return null;
  }
  return nativeKindForRule(input.scoreDayRule);
}

export function mapPriorDayVsToScoreEntries(
  rows: ReadonlyArray<{
    memberId: string;
    memberName: string;
    priorDayVsScore?: number;
    isViewer?: boolean;
  }>,
): ScoreLeaderboardEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    memberId: row.memberId,
    memberName: row.memberName,
    score: row.priorDayVsScore ?? 0,
    ...(row.isViewer ? { isViewer: true } : {}),
  }));
}
