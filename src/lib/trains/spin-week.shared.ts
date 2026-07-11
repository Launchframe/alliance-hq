import {
  canSpinConductorForDay,
  effectiveConductorMechanism,
} from "@/lib/trains/conductor-mechanism.shared";
import { weekDatesFromMonday } from "@/lib/trains/game-time";
import { formatTrainScheduleDateLabel } from "@/lib/trains/week-template-change.shared";
import type { WeekTemplateType } from "@/lib/trains/types";

export type SpinWeekDayConfig = {
  date: string;
  conductorMechanism: string | null;
  paintTemplate?: WeekTemplateType | null;
};

export type SpinWeekDayRecord = {
  date: string;
  lockedAt?: string | null;
};

export type SpinWeekResultRow = {
  date: string;
  dayLabel: string;
  memberId: string;
  memberName: string;
};

/** True when the day shows “Spin the wheel” (not sequence assign or leaderboard auto-pick). */
export function showsConductorSpinWheel(
  conductorMechanism: string | null | undefined,
  locked: boolean,
  paintTemplate?: WeekTemplateType | null,
  date?: string | null,
): boolean {
  if (
    !canSpinConductorForDay(conductorMechanism, locked, paintTemplate, date)
  ) {
    return false;
  }
  const mechanism = effectiveConductorMechanism(
    conductorMechanism,
    paintTemplate,
    date,
  );
  return mechanism !== "r4_sequence";
}

export function spinWheelDatesForRestOfWeek(input: {
  today: string;
  weekStart: string;
  weekEnd: string;
  dayConfigs: SpinWeekDayConfig[];
  weekRecords: SpinWeekDayRecord[];
}): string[] {
  return weekDatesFromMonday(input.weekStart)
    .filter((date) => date >= input.today && date <= input.weekEnd)
    .filter((date) => {
      const config = input.dayConfigs.find((row) => row.date === date);
      const record = input.weekRecords.find((row) => row.date === date);
      const locked = Boolean(record?.lockedAt);
      return showsConductorSpinWheel(
        config?.conductorMechanism ?? null,
        locked,
        config?.paintTemplate,
        date,
      );
    });
}

/** True when the viewed week still has at least one actionable calendar day (today or later). */
export function canSpinConductorWeek(weekEnd: string, today: string): boolean {
  return weekEnd >= today;
}

export function spinWeekDayLabel(date: string): string {
  return formatTrainScheduleDateLabel(date);
}
