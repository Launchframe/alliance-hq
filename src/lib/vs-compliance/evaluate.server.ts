import "server-only";

import { listActiveTimeOffEntries } from "@/lib/time-off/repository.server";
import { fetchAllianceVsTotalsForDateRange } from "@/lib/trains/vs-scores.server";
import {
  isVsWeekExcusedByTimeOff,
  vsComplianceTaskKindForStrike,
} from "@/lib/vs-compliance/evaluate.shared";
import {
  deactivateVsComplianceInboxItem,
  materializeVsComplianceInboxItem,
} from "@/lib/vs-compliance/vs-compliance-inbox.server";
import {
  listActiveRosterMembersForCompliance,
  upsertVsComplianceEventForWeek,
} from "@/lib/vs-compliance/repository.server";
import { loadVsMembershipSettings } from "@/lib/vs-compliance/vs-membership-settings.server";

export type VsComplianceWeeklyEvaluationResult = {
  allianceId: string;
  vsWeekEnding: string;
  evaluated: number;
  misses: number;
  cleared: number;
  skippedReason?: "minimums_off" | "no_ashed_connection";
};

/**
 * Evaluate one alliance's VS minimum compliance for a single Mon–Sat week.
 * Pure orchestration over VS totals + local roster + time-off; enforcement
 * runs when an officer confirms the task on `/vs-compliance`.
 */
export async function evaluateAllianceVsComplianceForWeek(input: {
  allianceId: string;
  weekStartMonday: string;
  weekEndSaturday: string;
  vsWeekEnding: string;
}): Promise<VsComplianceWeeklyEvaluationResult> {
  const settings = await loadVsMembershipSettings(input.allianceId, false);
  if (!settings.minPoints || settings.minPoints <= 0) {
    return {
      allianceId: input.allianceId,
      vsWeekEnding: input.vsWeekEnding,
      evaluated: 0,
      misses: 0,
      cleared: 0,
      skippedReason: "minimums_off",
    };
  }

  const [totals, roster, timeOffEntries] = await Promise.all([
    fetchAllianceVsTotalsForDateRange(
      input.allianceId,
      input.weekStartMonday,
      input.weekEndSaturday,
    ),
    listActiveRosterMembersForCompliance(input.allianceId),
    listActiveTimeOffEntries({
      allianceId: input.allianceId,
      rangeStart: input.weekStartMonday,
      rangeEnd: input.weekEndSaturday,
    }),
  ]);

  if (totals === null) {
    return {
      allianceId: input.allianceId,
      vsWeekEnding: input.vsWeekEnding,
      evaluated: 0,
      misses: 0,
      cleared: 0,
      skippedReason: "no_ashed_connection",
    };
  }

  const timeOffByMember = new Map<string, typeof timeOffEntries>();
  for (const entry of timeOffEntries) {
    const list = timeOffByMember.get(entry.ashedMemberId) ?? [];
    list.push(entry);
    timeOffByMember.set(entry.ashedMemberId, list);
  }

  let misses = 0;
  let cleared = 0;

  for (const member of roster) {
    const score = totals.get(member.ashedMemberId) ?? 0;
    const memberTimeOff = timeOffByMember.get(member.ashedMemberId) ?? [];
    const excused = isVsWeekExcusedByTimeOff(
      memberTimeOff,
      input.weekStartMonday,
      input.weekEndSaturday,
    );

    const { event, becameMiss, clearedFromMiss } =
      await upsertVsComplianceEventForWeek({
        allianceId: input.allianceId,
        ashedMemberId: member.ashedMemberId,
        memberName: member.memberName,
        vsWeekEnding: input.vsWeekEnding,
        score,
        minPoints: settings.minPoints,
        leewayPct: settings.leewayPct,
        excused,
      });

    if (becameMiss) {
      misses += 1;
      const kind = vsComplianceTaskKindForStrike(
        event.strikeNumber ?? 1,
        settings.missStrikesBeforeKick,
      );
      await materializeVsComplianceInboxItem({
        allianceId: input.allianceId,
        eventId: event.id,
        kind,
        memberName: member.memberName,
      });
    } else if (clearedFromMiss) {
      cleared += 1;
      await deactivateVsComplianceInboxItem(event.id);
    }
  }

  return {
    allianceId: input.allianceId,
    vsWeekEnding: input.vsWeekEnding,
    evaluated: roster.length,
    misses,
    cleared,
  };
}
