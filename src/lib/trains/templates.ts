import type {
  ConductorMechanismType,
  DayConfigInput,
  EventTopXConfig,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";
import {
  addCalendarDays,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";
import {
  dayIndexInTrainWeekForSchedule,
  isCompositeWeekTemplate,
  segmentTemplateForDayIndex,
} from "@/lib/trains/week-template-registry.shared";
import { weekDatesInTrainWeek } from "@/lib/trains/train-week-calendar.shared";

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
  return dayIndexInTrainWeekForSchedule(dateStr, weekStart);
}

function pushWeekDay(
  date: string,
  _weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput {
  const calDow = getServerDayOfWeek(date);
  if (calDow === 1) {
    // Train-week Monday: VS is off on Sunday (T-1) — use donations, not VS wheel.
    return {
      date,
      conductorMechanism: "donations_top",
      vipMechanism: options?.mondayVipMechanism ?? "donations_second",
    };
  }
  if (calDow === 2) {
    return {
      date,
      conductorMechanism: "vs_high_score",
      vipMechanism: "conductor_pick",
    };
  }
  if (calDow === 3 || calDow === 4 || calDow === 6) {
    // Wed, Thu, Sat — random draw from prior-day VS top 10.
    return {
      date,
      conductorMechanism: "vs_top_10",
      vipMechanism: "conductor_pick",
    };
  }
  if (calDow === 5) {
    // Fri — prior-day VS #1 (auto).
    return {
      date,
      conductorMechanism: "vs_high_score",
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
  const calDow = getServerDayOfWeek(date);
  if (calDow === 0) {
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
  const dates = weekDatesInTrainWeek(weekStart);

  if (isCompositeWeekTemplate(templateType)) {
    return dates.map((date) => {
      const segment = segmentTemplateForDayIndex(
        templateType,
        dayNameIndex(date, weekStart),
      );
      if (isCompositeWeekTemplate(segment)) {
        return {
          date,
          conductorMechanism: "custom" as ConductorMechanismType,
          vipMechanism: "none" as VipMechanismType,
        };
      }
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
    case "price_is_right_weekdays":
      return dates.map((date) => ({
        date,
        conductorMechanism: "r3_lottery" as ConductorMechanismType,
        vipMechanism: "conductor_pick" as VipMechanismType,
      }));
    case "takedown_week":
      return dates.map((date) => ({
        date,
        conductorMechanism: "heavy_hitter_lottery" as ConductorMechanismType,
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
    mechanism === "heavy_hitter_lottery" ||
    mechanism === "r4_sequence" ||
    mechanism === "event_top_x_lottery"
  );
}

/** Officer manual pick — conductor_pick days need this to record the conductor's choice. */
export function supportsManualVipPick(
  mechanism: VipMechanismType | string | null | undefined,
): boolean {
  if (!mechanism) return false;
  return (
    mechanism === "conductor_pick" ||
    mechanism === "donations_second" ||
    mechanism === "event_top_x_lottery"
  );
}

/** Officer manual override when leaderboard data is missing or wrong. */
export function supportsManualConductorPick(
  mechanism: ConductorMechanismType | string | null | undefined,
): boolean {
  if (!mechanism) return false;
  return (
    mechanism === "r3_lottery" ||
    mechanism === "heavy_hitter_lottery" ||
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
): "r3" | "r4_plus" | "all_members" | "heavy_hitter" | null {
  switch (mechanism) {
    case "r3_lottery":
      return "r3";
    case "heavy_hitter_lottery":
      return "heavy_hitter";
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
