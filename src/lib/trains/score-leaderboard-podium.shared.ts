import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";
import { resolveConductorTopNBoard } from "@/lib/trains/conductor-top-n.shared";
import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";

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

export function resolveScoreLeaderboardKind(input: {
  paintTemplate: WeekTemplateType | string | null | undefined;
  conductorMechanism: ConductorMechanismType | string | null | undefined;
}): ScoreLeaderboardKind | null {
  if (usesPriceIsFreightConductorRoll(input.paintTemplate)) {
    return "tpif";
  }

  const topBoard = resolveConductorTopNBoard(
    input.conductorMechanism,
    undefined,
  );
  if (topBoard?.kind === "vs") {
    return "vs_push";
  }

  if (
    input.paintTemplate === "vs_push_week" ||
    input.paintTemplate === "vs_push_weekdays" ||
    input.paintTemplate === "top_vs"
  ) {
    return "vs_push";
  }

  if (
    input.paintTemplate === "donations_week" ||
    input.conductorMechanism === "donations_top"
  ) {
    return "donations";
  }

  return null;
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
