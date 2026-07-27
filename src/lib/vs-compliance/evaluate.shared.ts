import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import { effectiveMinimum } from "@/lib/trains/train-conductor-minimums.shared";
import type {
  VsComplianceOfficerTaskStatus,
  VsComplianceOutcome,
} from "@/lib/vs-compliance/types.shared";

export const VS_DEMOTION_TASK_KIND = "vs_demotion_task" as const;
export const VS_KICK_TASK_KIND = "vs_kick_task" as const;

export type VsComplianceTaskKind =
  | typeof VS_DEMOTION_TASK_KIND
  | typeof VS_KICK_TASK_KIND;

/** Effective weekly VS point floor after leeway — e.g. min 1,000,000 with 10% leeway → 900,000. */
export function effectiveVsMembershipThreshold(
  minPoints: number,
  leewayPct: number,
): number {
  return effectiveMinimum(minPoints, leewayPct);
}

/**
 * Mon–Sat VS week range and Sunday week-ending date for the week that just
 * completed relative to `todayServerDate` (the calendar week before the
 * current one). Used by the Monday-morning cron to evaluate last week.
 */
export function previousVsWeekRange(todayServerDate: string): {
  weekStartMonday: string;
  weekEndSaturday: string;
  weekEnding: string;
} {
  const currentWeekMonday = getWeekStartMonday(todayServerDate);
  const weekStartMonday = addCalendarDays(currentWeekMonday, -7);
  const weekEndSaturday = addCalendarDays(weekStartMonday, 5);
  const weekEnding = addCalendarDays(weekStartMonday, 6);
  return { weekStartMonday, weekEndSaturday, weekEnding };
}

/** Sunday week-ending date for the Mon–Sat week starting on `weekStartMonday`. */
export function vsWeekEndingFromMonday(weekStartMonday: string): string {
  return addCalendarDays(weekStartMonday, 6);
}

export type TimeOffExcusalCandidate = {
  startDate: string;
  endDate: string;
  activityScope: "vs" | "donation" | "all";
  availability: "full_away" | "limited" | "minimums" | "hit_and_miss";
  entryKind: "planned" | "officer_marked" | "unexpected";
};

/**
 * A single time-off entry excuses a VS week when it: overlaps the Mon–Sat
 * week, is an active planned/officer-marked entry (not "unexpected", which
 * is logged after the fact and does not pre-excuse), covers VS activity
 * ("vs" or "all" scope), and the member did not opt to still cover minimums
 * ("minimums" availability means they're away but still hold up their VS).
 */
export function timeOffEntryExcusesVsWeek(
  entry: TimeOffExcusalCandidate,
  weekStartMonday: string,
  weekEndSaturday: string,
): boolean {
  if (entry.entryKind !== "planned" && entry.entryKind !== "officer_marked") {
    return false;
  }
  if (entry.activityScope !== "vs" && entry.activityScope !== "all") {
    return false;
  }
  if (entry.availability === "minimums") {
    return false;
  }
  return entry.startDate <= weekEndSaturday && entry.endDate >= weekStartMonday;
}

export function isVsWeekExcusedByTimeOff(
  entries: readonly TimeOffExcusalCandidate[],
  weekStartMonday: string,
  weekEndSaturday: string,
): boolean {
  return entries.some((entry) =>
    timeOffEntryExcusesVsWeek(entry, weekStartMonday, weekEndSaturday),
  );
}

export type VsWeekOutcomeInput = {
  score: number;
  minPoints: number;
  leewayPct: number;
  excused: boolean;
  /** Count of prior non-waived "miss" outcomes for this member before this week. */
  priorMissCount: number;
};

export type VsWeekOutcomeResult = {
  threshold: number;
  outcome: VsComplianceOutcome;
  strikeNumber: number | null;
};

/** Pure evaluation of one member/week — no DB or network access. */
export function evaluateVsWeekOutcome(
  input: VsWeekOutcomeInput,
): VsWeekOutcomeResult {
  const threshold = effectiveVsMembershipThreshold(
    input.minPoints,
    input.leewayPct,
  );

  if (input.excused || input.score >= threshold) {
    return { threshold, outcome: "ok", strikeNumber: null };
  }

  return {
    threshold,
    outcome: "miss",
    strikeNumber: input.priorMissCount + 1,
  };
}

/** Kick recommendation once accumulated strikes reach the alliance's configured limit. */
export function vsComplianceTaskKindForStrike(
  strikeNumber: number,
  missStrikesBeforeKick: number,
): VsComplianceTaskKind {
  return strikeNumber >= missStrikesBeforeKick
    ? VS_KICK_TASK_KIND
    : VS_DEMOTION_TASK_KIND;
}

/** Officer task status implied by a freshly computed outcome (before any prior row is considered). */
export function officerTaskStatusForOutcome(
  outcome: VsComplianceOutcome,
): VsComplianceOfficerTaskStatus {
  if (outcome === "miss") return "open";
  if (outcome === "waived") return "waived";
  return "none";
}
