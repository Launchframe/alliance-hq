import type {
  ConductorMechanismType,
  DayConfigInput,
  EventTopXConfig,
  VipMechanismType,
  WeekTemplateType,
} from "@/lib/trains/types";
import { addCalendarDays, weekDatesFromMonday } from "@/lib/trains/game-time";

export type WeekTemplateOptions = {
  mondayVipMechanism?: VipMechanismType;
  saturdayVipEvent?: EventTopXConfig;
  sundayVipEvent?: EventTopXConfig;
};

const DEFAULT_SAT_VIP: EventTopXConfig = {
  eventKey: "capitol_war",
  topN: 10,
};

const DEFAULT_SUN_VIP: EventTopXConfig = {
  eventKey: "meteorite_war",
  topN: 10,
};

function dayNameIndex(dateStr: string, weekStart: string): number {
  const dates = weekDatesFromMonday(weekStart);
  return dates.indexOf(dateStr);
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
      conductorMechanism: "vs_high_score",
      vipMechanism: options?.mondayVipMechanism ?? "donations_second",
    };
  }
  if (idx >= 1 && idx <= 4) {
    return {
      date,
      conductorMechanism: "vs_top_10",
      vipMechanism: "conductor_pick",
    };
  }
  if (idx === 5) {
    return {
      date,
      conductorMechanism: "r4_sequence",
      vipMechanism: "event_top_x_lottery",
      vipConfig: options?.saturdayVipEvent ?? DEFAULT_SAT_VIP,
    };
  }
  return {
    date,
    conductorMechanism: "r4_sequence",
    vipMechanism: "event_top_x_lottery",
    vipConfig: options?.sundayVipEvent ?? DEFAULT_SUN_VIP,
  };
}

export function generateWeekDayConfigs(
  templateType: WeekTemplateType,
  weekStart: string,
  options?: WeekTemplateOptions,
): DayConfigInput[] {
  const dates = weekDatesFromMonday(weekStart);

  switch (templateType) {
    case "vs_push_week":
      return dates.map((date) => pushWeekDay(date, weekStart, options));
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

export { addCalendarDays };
