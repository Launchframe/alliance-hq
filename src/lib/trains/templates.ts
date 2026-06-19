import type {
  ConductorMechanismType,
  DayConfigInput,
  EventTopXConfig,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";
import { addCalendarDays, weekDatesFromMonday } from "@/lib/trains/game-time";
import {
  dayIndexInWeek,
  isCompositeWeekTemplate,
  segmentTemplateForDayIndex,
} from "@/lib/trains/week-template-registry.shared";

export type WeekTemplateOptions = {
  mondayVipMechanism?: VipMechanismType;
  /** Optional event VIP config for r4_event_vip / weekend segments. */
  weekendVipEvent?: EventTopXConfig;
  /** @deprecated Use weekendVipEvent */
  saturdayVipEvent?: EventTopXConfig;
  /** @deprecated Use weekendVipEvent */
  sundayVipEvent?: EventTopXConfig;
};

const DEFAULT_WEEKEND_VIP_EVENT: EventTopXConfig = {
  eventKey: "capitol_war",
  topN: 10,
};

function dayNameIndex(dateStr: string, weekStart: string): number {
  return dayIndexInWeek(dateStr, weekStart);
}

function pushWeekDay(
  date: string,
  weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput {
  const idx = dayNameIndex(date, weekStart);
  if (idx === 0) {
    return {
      date,
      conductorMechanism: "vs_top_10",
      vipMechanism: options?.mondayVipMechanism ?? "donations_second",
    };
  }
  if (idx === 1) {
    return {
      date,
      conductorMechanism: "vs_high_score",
      vipMechanism: "conductor_pick",
    };
  }
  if (idx >= 2 && idx <= 4) {
    return {
      date,
      conductorMechanism: "vs_top_10",
      vipMechanism: "conductor_pick",
    };
  }
  return r4EventVipDay(date, options);
}

function r4EventVipDay(
  date: string,
  options?: WeekTemplateOptions,
): DayConfigInput {
  const vipConfig =
    options?.weekendVipEvent ??
    options?.saturdayVipEvent ??
    options?.sundayVipEvent ??
    DEFAULT_WEEKEND_VIP_EVENT;
  return {
    date,
    conductorMechanism: "r4_sequence",
    vipMechanism: "event_top_x_lottery",
    vipConfig,
  };
}

function weekdayPushConfig(
  date: string,
  weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput {
  const idx = dayNameIndex(date, weekStart);
  if (idx < 0 || idx > 4) {
    return {
      date,
      conductorMechanism: "custom",
      vipMechanism: "none",
    };
  }
  return pushWeekDay(date, weekStart, options);
}

export function generateDayConfigForDate(
  templateType: WeekTemplateType,
  date: string,
  weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput {
  const configs = generateWeekDayConfigs(templateType, weekStart, options);
  return (
    configs.find((c) => c.date === date) ?? {
      date,
      conductorMechanism: "custom",
      vipMechanism: "none",
    }
  );
}

export function generateWeekDayConfigs(
  templateType: WeekTemplateType,
  weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput[] {
  const dates = weekDatesFromMonday(weekStart);

  if (isCompositeWeekTemplate(templateType)) {
    return dates.map((date) => {
      const segment = segmentTemplateForDayIndex(
        templateType,
        dayNameIndex(date, weekStart),
      );
      return generateDayConfigForDate(segment, date, weekStart, options);
    });
  }

  switch (templateType) {
    case "vs_push_weekdays":
      return dates.map((date) => weekdayPushConfig(date, weekStart, options));
    case "r4_event_vip":
      return dates.map((date) => r4EventVipDay(date, options));
    case "economy_week":
    case "r3_recognition":
      return dates.map((date) => ({
        date,
        conductorMechanism: "r3_lottery" as ConductorMechanismType,
        vipMechanism: "conductor_pick" as VipMechanismType,
      }));
    case "r4_train_week":
      return dates.map((date) => ({
        date,
        conductorMechanism: "r4_sequence" as ConductorMechanismType,
        vipMechanism: "conductor_pick" as VipMechanismType,
      }));
    case "donations_week":
      return dates.map((date) => ({
        date,
        conductorMechanism: "donations_top" as ConductorMechanismType,
        vipMechanism: "donations_second" as VipMechanismType,
      }));
    case "custom":
    default:
      return dates.map((date) => ({
        date,
        conductorMechanism: "custom" as ConductorMechanismType,
        vipMechanism: "none" as VipMechanismType,
      }));
  }
}

export function mechanismNeedsWheel(
  mechanism: ConductorMechanismType | VipMechanismType | null | undefined,
): boolean {
  if (!mechanism) return false;
  return (
    mechanism === "vs_top_10" ||
    mechanism === "r3_lottery" ||
    mechanism === "r4_sequence" ||
    mechanism === "event_top_x_lottery"
  );
}

/** Officer manual override when leaderboard data is missing or wrong. */
export function supportsManualVipPick(
  mechanism: VipMechanismType | string | null | undefined,
): boolean {
  if (!mechanism) return false;
  return (
    mechanism === "donations_second" || mechanism === "event_top_x_lottery"
  );
}

/** Officer manual override when leaderboard data is missing or wrong. */
export function supportsManualConductorPick(
  mechanism: ConductorMechanismType | string | null | undefined,
): boolean {
  if (!mechanism) return false;
  return (
    mechanism === "r3_lottery" ||
    mechanism === "vs_high_score" ||
    mechanism === "vs_top_10" ||
    mechanism === "donations_top" ||
    mechanism === "r4_sequence" ||
    mechanism === "officer_pick" ||
    mechanism === "custom"
  );
}

export function conductorMechanismPoolType(
  mechanism: ConductorMechanismType,
): "r3" | "r4_plus" | "all_members" | null {
  switch (mechanism) {
    case "r3_lottery":
      return "r3";
    case "r4_sequence":
      return "r4_plus";
    default:
      return null;
  }
}

export function vipMechanismPoolType(
  mechanism: VipMechanismType,
): "event_top_x" | null {
  if (mechanism === "event_top_x_lottery") return "event_top_x";
  return null;
}

export { addCalendarDays };
