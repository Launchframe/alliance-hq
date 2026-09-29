import { z } from "zod";

import { addCalendarDays, getServerDayOfWeek, getWeekStartMonday } from "@/lib/trains/game-time";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { clampTrainConductorLeadTimeDays } from "@/lib/trains/vs-week-days.shared";

export const VS_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const VS_DAY_POINTS = [1, 2, 2, 2, 2, 4] as const;
export const VS_PLATFORMS = ["price_is_freight", "save_week", "strategic_victory", "all_out_domination"] as const;
export const VS_DAY_STRATEGIES = ["undecided", "push", "hard_save", "soft_save", "unrestricted"] as const;
export const vsTopNSchema = z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10)]);
export type VsTopN = z.infer<typeof vsTopNSchema>;
export type VsPlatform = (typeof VS_PLATFORMS)[number];
export type VsDayStrategy = (typeof VS_DAY_STRATEGIES)[number];
export type VsWeekday = (typeof VS_WEEKDAYS)[number];

export class VsPerformanceError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
}

export function isVsCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const vsDateSchema = z.string().refine(isVsCalendarDate);
export const vsWeekStartSchema = vsDateSchema.refine((date) => getServerDayOfWeek(date) === 1);
export const vsPushDefaultsSchema = z.object({
  mon: vsTopNSchema, tue: vsTopNSchema, wed: vsTopNSchema,
  thu: vsTopNSchema, fri: vsTopNSchema, sat: vsTopNSchema,
}).strict();
export type VsPushDefaults = z.infer<typeof vsPushDefaultsSchema>;
export const DEFAULT_VS_PUSH_REWARDS: VsPushDefaults = { mon: 1, tue: 10, wed: 10, thu: 1, fri: 10, sat: 10 };

export const vsPlanDaySchema = z.object({
  scoreDate: vsDateSchema,
  strategy: z.enum(VS_DAY_STRATEGIES),
  pushTopN: vsTopNSchema,
  heavyHitterReward: z.boolean(),
}).strict().refine((day) => !day.heavyHitterReward || day.strategy === "unrestricted");
export type VsPlanDay = z.infer<typeof vsPlanDaySchema>;
export const vsPlanDraftSchema = z.object({
  weekStart: vsWeekStartSchema,
  platform: z.enum(VS_PLATFORMS),
  days: z.array(vsPlanDaySchema).length(6),
}).strict().superRefine((draft, context) => {
  draft.days.forEach((day, index) => {
    if (day.scoreDate !== addCalendarDays(draft.weekStart, index)) {
      context.addIssue({ code: "custom", path: ["days", index, "scoreDate"], message: "invalid" });
    }
    if (day.heavyHitterReward && index !== 4) {
      context.addIssue({ code: "custom", path: ["days", index, "heavyHitterReward"], message: "invalid" });
    }
  });
});
export type VsPlanDraft = z.infer<typeof vsPlanDraftSchema>;

export function vsDatesForWeek(weekStart: string): string[] {
  if (!vsWeekStartSchema.safeParse(weekStart).success) throw new VsPerformanceError("invalid");
  return VS_WEEKDAYS.map((_, index) => addCalendarDays(weekStart, index));
}

export function vsDayIndex(weekStart: string, scoreDate: string): number {
  const index = vsDatesForWeek(weekStart).indexOf(scoreDate);
  if (index < 0) throw new VsPerformanceError("invalid");
  return index;
}

export function vsTrainDate(scoreDate: string, leadDays: number): string {
  if (!isVsCalendarDate(scoreDate) || getServerDayOfWeek(scoreDate) === 0) throw new VsPerformanceError("invalid");
  return addCalendarDays(scoreDate, 1 + clampTrainConductorLeadTimeDays(leadDays));
}

export function buildVsPlatformDraft(weekStart: string, platform: VsPlatform, defaults: VsPushDefaults = DEFAULT_VS_PUSH_REWARDS): VsPlanDraft {
  const days = vsDatesForWeek(weekStart).map((scoreDate, index): VsPlanDay => ({
    scoreDate,
    strategy: platform === "price_is_freight" ? index < 4 ? "hard_save" : "unrestricted"
      : platform === "save_week" ? "soft_save"
        : platform === "all_out_domination" ? "push" : "undecided",
    pushTopN: defaults[VS_WEEKDAYS[index]],
    heavyHitterReward: platform === "price_is_freight" && index === 4,
  }));
  return vsPlanDraftSchema.parse({ weekStart, platform, days });
}

export function conductorRuleForVsPlanDay(day: VsPlanDay): ConductorRule | undefined {
  switch (day.strategy) {
    case "push": return { kind: "vs_top_n", topN: day.pushTopN };
    case "hard_save": return { kind: "price_is_freight", board: "weekday" };
    case "soft_save": return { kind: "rank_pool", pool: "r3", draw: "wheel" };
    case "unrestricted": return day.heavyHitterReward ? { kind: "price_is_freight", board: "heavy_hitter" } : undefined;
    case "undecided": return undefined;
  }
}

export function vsPlannedPushPoints(days: readonly VsPlanDay[], weekStart: string): number {
  const seen = new Set<string>();
  return days.reduce((total, day) => {
    if (seen.has(day.scoreDate)) throw new VsPerformanceError("invalid");
    seen.add(day.scoreDate);
    const index = vsDayIndex(weekStart, day.scoreDate);
    return total + (day.strategy === "push" ? VS_DAY_POINTS[index] : 0);
  }, 0);
}

export function vsWeekForDate(date: string): string {
  if (!isVsCalendarDate(date)) throw new VsPerformanceError("invalid");
  return getWeekStartMonday(date);
}
