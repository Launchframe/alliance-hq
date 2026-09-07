import "server-only";

import { getServerCalendarDate } from "@/lib/trains/game-time";
import { previousVsWeekRange } from "@/lib/vs-compliance/evaluate.shared";
import {
  evaluateAllianceVsComplianceForWeek,
  type VsComplianceWeeklyEvaluationResult,
} from "@/lib/vs-compliance/evaluate.server";
import { listAllianceIdsWithVsMembershipEnforcement } from "@/lib/vs-compliance/vs-membership-settings.server";

export type VsComplianceWeeklyAllianceResult = VsComplianceWeeklyEvaluationResult & {
  error?: string;
};

export type VsComplianceWeeklyCronResult = {
  vsWeekEnding: string;
  alliances: VsComplianceWeeklyAllianceResult[];
};

/**
 * Evaluate VS membership compliance for the previously completed Mon–Sat
 * week (week ending the prior Sunday) across every alliance with VS
 * membership minimums configured. Called by the Monday-morning cron; also
 * safe to call manually/from a post-VS-video-commit hook since evaluation is
 * idempotent per (alliance, member, week).
 */
export async function runVsComplianceWeeklyEvaluation(
  now = new Date(),
): Promise<VsComplianceWeeklyCronResult> {
  const todayServerDate = getServerCalendarDate(now);
  const { weekStartMonday, weekEndSaturday, weekEnding } =
    previousVsWeekRange(todayServerDate);

  const allianceIds = await listAllianceIdsWithVsMembershipEnforcement();

  const alliances: VsComplianceWeeklyAllianceResult[] = [];
  for (const allianceId of allianceIds) {
    try {
      const result = await evaluateAllianceVsComplianceForWeek({
        allianceId,
        weekStartMonday,
        weekEndSaturday,
        vsWeekEnding: weekEnding,
      });
      alliances.push(result);
    } catch (error) {
      alliances.push({
        allianceId,
        vsWeekEnding: weekEnding,
        evaluated: 0,
        misses: 0,
        cleared: 0,
        error: error instanceof Error ? error.message : "evaluation failed",
      });
    }
  }

  return { vsWeekEnding: weekEnding, alliances };
}
