import { effectiveConductorMechanism } from "@/lib/trains/conductor-mechanism.shared";
import { resolveConductorTopNBoard } from "@/lib/trains/conductor-top-n.shared";
import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";
import type { ConductorMechanismType, WeekTemplateType } from "@/lib/trains/types";
import {
  priorDayVsAppliesForTrainDate,
  scoreDateDayUsesPriorDayVsScores,
  type ScoreDateDayConfig,
} from "@/lib/trains/vs-data-status.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";
import { resolvePaintTemplateForDay } from "@/lib/trains/week-template-registry.shared";

function isTpiFWeekTemplate(
  templateType: WeekTemplateType | string | null | undefined,
): boolean {
  return (
    templateType === "price_is_right" ||
    templateType === "price_is_right_weekdays"
  );
}

function segmentLeaderboardKindForWeekTemplate(input: {
  weekTemplateType?: WeekTemplateType | string | null;
  trainDate?: string | null;
  weekStart?: string | null;
  conductorMechanism?: ConductorMechanismType | string | null | undefined;
}): ScoreLeaderboardKind | null {
  if (!isTpiFWeekTemplate(input.weekTemplateType)) return null;
  if (!input.trainDate || !input.weekStart) return null;

  const segmentPaint = resolvePaintTemplateForDay(
    input.weekTemplateType as WeekTemplateType,
    input.trainDate,
    input.weekStart,
  );
  return resolveNativeScoreLeaderboardKind({
    paintTemplate: segmentPaint,
    conductorMechanism: input.conductorMechanism,
  });
}

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

function resolveNativeScoreLeaderboardKind(input: {
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

export function resolveScoreLeaderboardKind(input: {
  paintTemplate: WeekTemplateType | string | null | undefined;
  conductorMechanism: ConductorMechanismType | string | null | undefined;
  trainDate?: string | null;
  leadDays?: number;
  scoreDateDay?: ScoreDateDayConfig | null;
  weekTemplateType?: WeekTemplateType | string | null;
  weekStart?: string | null;
}): ScoreLeaderboardKind | null {
  const segmentKind = segmentLeaderboardKindForWeekTemplate(input);
  const native = resolveNativeScoreLeaderboardKind(input);
  if (segmentKind === "tpif" || native === "tpif") {
    return "tpif";
  }
  if (native) return native;

  const leadDays = input.leadDays ?? 0;
  if (leadDays <= 0 || !input.trainDate || !input.scoreDateDay) {
    return null;
  }
  if (!priorDayVsAppliesForTrainDate(input.trainDate, leadDays)) {
    return null;
  }

  const scoreDate = vsScoreReferenceDate(input.trainDate, leadDays);
  if (!scoreDateDayUsesPriorDayVsScores(input.scoreDateDay, scoreDate)) {
    return null;
  }

  return resolveNativeScoreLeaderboardKind({
    paintTemplate: input.scoreDateDay.paintTemplate,
    conductorMechanism: effectiveConductorMechanism(
      input.scoreDateDay.conductorMechanism,
      input.scoreDateDay.paintTemplate as WeekTemplateType | null,
      scoreDate,
    ),
  });
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
