import { conductorDrawChanged } from "@/lib/trains/conductor-mechanism.shared";
import { conductorSpinSource } from "@/lib/trains/spin-source.shared";
import { generateDayConfigForDate } from "@/lib/trains/templates";
import {
  getTrainWeekStart,
  type AllianceTrainWeekConfig,
} from "@/lib/trains/train-week-calendar.shared";
import type { WeekConductorRecordSummary } from "@/lib/trains/conductor-record.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import {
  resolveLiteralDayPaintTemplate,
  resolvePaintTemplateForCalendarDate,
} from "@/lib/trains/week-template-registry.shared";

export const LOCKED_DAY_PAINT_BLOCKED_CODE = "locked_day_paint_blocked";

/** Client-safe rank check — keep in lockstep with `isMemberEligibleForPool`. */
function rankEligibleForPaintPool(
  poolType: "r3" | "r4_plus" | "all_members" | "heavy_hitter" | "event_top_x",
  rank: number | null,
): boolean {
  if (poolType === "heavy_hitter" || poolType === "all_members") return true;
  if (rank == null) return false;
  if (poolType === "r3") return rank === 3;
  if (poolType === "r4_plus") return rank >= 4;
  return false;
}

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
  conductorMechanism: string | null;
  paintTemplate?: WeekTemplateType | string | null;
  conductorConfig?: unknown;
  topN?: number | null;
};

export type PaintRuleRosterMember = {
  memberId: string;
  allianceRank?: number | null;
};

export function isMemberEligibleForPaintRule(input: {
  memberId: string | null | undefined;
  onRoster: boolean;
  allianceRank: number | null | undefined;
  conductorMechanism: string | null | undefined;
  paintTemplate: WeekTemplateType | string | null | undefined;
  date: string;
  conductorConfig?: unknown;
}): boolean {
  if (!input.memberId || !input.onRoster) return false;

  const source = conductorSpinSource(
    input.conductorMechanism,
    input.paintTemplate as WeekTemplateType | null,
    input.date,
    input.conductorConfig,
  );

  if (source == null) {
    return true;
  }
  if (source.kind === "pool") {
    return rankEligibleForPaintPool(source.poolType, input.allianceRank ?? null);
  }
  if (source.kind === "price_is_right_raffle") {
    return rankEligibleForPaintPool("r3", input.allianceRank ?? null);
  }
  if (source.kind === "donations_leaderboard") {
    return true;
  }
  return false;
}

export function resolvePaintNextDraw(input: {
  date: string;
  templateType: WeekTemplateType;
  trainWeekConfig: AllianceTrainWeekConfig;
  weekTemplateApply: boolean;
  topN?: number | null;
}): {
  conductorMechanism: string;
  vipMechanism: string | null;
  paintTemplate: WeekTemplateType;
  conductorConfig: unknown;
} {
  const weekStart = getTrainWeekStart(input.date, input.trainWeekConfig);
  const generated = generateDayConfigForDate(
    input.weekTemplateApply
      ? input.templateType
      : resolveLiteralDayPaintTemplate(input.templateType),
    input.date,
    weekStart,
    input.topN != null ? { topN: input.topN as 1 | 3 | 5 | 10 } : undefined,
  );
  const paintTemplate = resolvePaintTemplateForCalendarDate({
    templateType: input.templateType,
    date: input.date,
    weekStart,
    weekTemplateApply: input.weekTemplateApply,
  });
  return {
    conductorMechanism: generated.conductorMechanism,
    vipMechanism: generated.vipMechanism ?? null,
    paintTemplate,
    conductorConfig: generated.conductorConfig,
  };
}

export function shouldKeepAssignedConductorOnPaint(input: {
  drawChanged: boolean;
  memberId: string | null | undefined;
  onRoster: boolean;
  allianceRank: number | null | undefined;
  nextMechanism: string | null | undefined;
  nextPaintTemplate: WeekTemplateType | string | null | undefined;
  date: string;
  nextConductorConfig?: unknown;
}): boolean {
  if (!input.memberId) return false;
  if (!input.drawChanged) return true;
  return isMemberEligibleForPaintRule({
    memberId: input.memberId,
    onRoster: input.onRoster,
    allianceRank: input.allianceRank,
    conductorMechanism: input.nextMechanism,
    paintTemplate: input.nextPaintTemplate,
    date: input.date,
    conductorConfig: input.nextConductorConfig,
  });
}

export function planPaintRuleConductorGates(input: {
  dates: string[];
  templateType: WeekTemplateType;
  trainWeekConfig: AllianceTrainWeekConfig;
  weekTemplateApply: boolean;
  topN?: number | null;
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
    const nextDraw = resolvePaintNextDraw({
      date: record.date,
      templateType: input.templateType,
      trainWeekConfig: input.trainWeekConfig,
      weekTemplateApply: input.weekTemplateApply,
      topN: input.topN,
    });
    const previousDraw = {
      conductorMechanism: previousDay?.conductorMechanism ?? record.conductorMechanism,
      paintTemplate: previousDay?.paintTemplate,
      date: record.date,
      conductorConfig: previousDay?.conductorConfig,
      topN: previousDay?.topN,
    };
    const drawChanged = conductorDrawChanged(previousDraw, {
      conductorMechanism: nextDraw.conductorMechanism,
      paintTemplate: nextDraw.paintTemplate,
      date: record.date,
      conductorConfig: nextDraw.conductorConfig,
      topN: input.topN ?? previousDay?.topN,
    });

    const rosterRow = rosterById.get(record.conductorMemberId);
    const keep = shouldKeepAssignedConductorOnPaint({
      drawChanged,
      memberId: record.conductorMemberId,
      onRoster: rosterRow != null,
      allianceRank: rosterRow?.allianceRank,
      nextMechanism: nextDraw.conductorMechanism,
      nextPaintTemplate: nextDraw.paintTemplate,
      date: record.date,
      nextConductorConfig: nextDraw.conductorConfig,
    });
    if (keep) continue;

    const locked = Boolean(record.lockedAt);
    const canUnlockThis = input.canUnlockConductor || Boolean(record.canUnlock);
    blockers.push({
      date: record.date,
      conductorMemberId: record.conductorMemberId,
      conductorName: record.conductorMemberName?.trim() || record.conductorMemberId,
      locked,
      kind: locked && !canUnlockThis ? "request_unlock" : "clear",
    });
  }

  return { blockers };
}
