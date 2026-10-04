import { conductorRuleChanged } from "@/lib/trains/rules/catalog.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { isMemberEligibleForConductorRule } from "@/lib/trains/rules/derive.shared";
import type { WeekConductorRecordSummary } from "@/lib/trains/conductor-record.shared";

export const LOCKED_DAY_PAINT_BLOCKED_CODE = "locked_day_paint_blocked";

export type PaintRuleConductorGateKind = "keep" | "clear" | "request_unlock";

export type PaintRuleConductorBlocker = {
  date: string;
  conductorMemberId: string;
  conductorName: string;
  locked: boolean;
  kind: Exclude<PaintRuleConductorGateKind, "keep">;
};

export type PaintRuleConductorGatePlan = {
  blockers: PaintRuleConductorBlocker[];
};

export type PaintRuleDayConfig = {
  date: string;
  conductorRule: ConductorRule | null;
};

export type PaintRuleRosterMember = {
  memberId: string;
  allianceRank?: number | null;
};

/**
 * Keep an assigned conductor when the day's rule changes, unless the new rule
 * provably excludes them. "Provably" is the point: see
 * `isMemberEligibleForConductorRule`, which fails open for boards the client
 * cannot see.
 */
export function shouldKeepAssignedConductorOnPaint(input: {
  ruleChanged: boolean;
  memberId: string | null | undefined;
  onRoster: boolean;
  allianceRank: number | null | undefined;
  nextRule: ConductorRule | null;
}): boolean {
  if (!input.memberId) return false;
  if (!input.ruleChanged) return true;
  return isMemberEligibleForConductorRule({
    memberId: input.memberId,
    onRoster: input.onRoster,
    allianceRank: input.allianceRank,
    rule: input.nextRule,
  });
}

export function planPaintRuleConductorGates(input: {
  dates: string[];
  nextRule: ConductorRule | null;
  dayConfigs: PaintRuleDayConfig[];
  records: WeekConductorRecordSummary[];
  roster: PaintRuleRosterMember[];
  canUnlockConductor: boolean;
}): PaintRuleConductorGatePlan {
  const dateSet = new Set(input.dates);
  const rosterById = new Map(input.roster.map((row) => [row.memberId, row]));
  const blockers: PaintRuleConductorBlocker[] = [];

  for (const record of input.records) {
    if (!dateSet.has(record.date) || !record.conductorMemberId) continue;

    const previousDay = input.dayConfigs.find((day) => day.date === record.date);
    const ruleChanged =
      conductorRuleChanged(previousDay?.conductorRule ?? null, input.nextRule) ||
      conductorRuleChanged(record.conductorRule, input.nextRule);

    const rosterRow = rosterById.get(record.conductorMemberId);
    const keep = shouldKeepAssignedConductorOnPaint({
      ruleChanged,
      memberId: record.conductorMemberId,
      onRoster: rosterRow != null,
      allianceRank: rosterRow?.allianceRank,
      nextRule: input.nextRule,
    });
    if (keep) continue;

    const locked = Boolean(record.lockedAt);
    const canUnlockThis = input.canUnlockConductor || Boolean(record.canUnlock);
    blockers.push({
      date: record.date,
      conductorMemberId: record.conductorMemberId,
      conductorName:
        record.conductorMemberName?.trim() || record.conductorMemberId,
      locked,
      kind: locked && !canUnlockThis ? "request_unlock" : "clear",
    });
  }

  return { blockers };
}
