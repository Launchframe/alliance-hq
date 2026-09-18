import { canSpinConductorForRule } from "@/lib/trains/conductor-mechanism.shared";
import { weekDatesFromMonday } from "@/lib/trains/game-time";
import { formatTrainScheduleDateLabel } from "@/lib/trains/week-template-change.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

export type SpinWeekDayConfig = {
  date: string;
  conductorRule: ConductorRule | null;
};

export type SpinWeekDayRecord = {
  date: string;
  lockedAt?: string | null;
  conductorMemberId?: string | null;
};

export type SpinWeekResultRow = {
  date: string;
  dayLabel: string;
  memberId: string;
  memberName: string;
};

/** True when the day shows “Spin the wheel” (not sequence assign or leaderboard auto-pick). */
export function showsConductorSpinWheel(
  rule: ConductorRule | null,
  locked: boolean,
): boolean {
  if (!canSpinConductorForRule(rule, locked)) return false;
  // R4 rotation assigns the next officer in sequence — no wheel.
  return !(rule?.kind === "rank_pool" && rule.pool === "r4_plus");
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
      return showsConductorSpinWheel(config?.conductorRule ?? null, locked);
    });
}

/** Wheel-eligible dates from an explicit list (month multi-select toolbar). */
export function spinWheelDatesFromList(input: {
  today: string;
  dates: string[];
  dayConfigs: SpinWeekDayConfig[];
  weekRecords: SpinWeekDayRecord[];
}): string[] {
  const unique = [...new Set(input.dates)].sort();
  return unique.filter((date) => {
    if (date < input.today) return false;
    const config = input.dayConfigs.find((row) => row.date === date);
    const record = input.weekRecords.find((row) => row.date === date);
    const locked = Boolean(record?.lockedAt);
    if (locked) return false;
    if (record?.conductorMemberId) return false;
    return showsConductorSpinWheel(config?.conductorRule ?? null, locked);
  });
}

/** True when the viewed week still has at least one actionable calendar day (today or later). */
export function canSpinConductorWeek(weekEnd: string, today: string): boolean {
  return weekEnd >= today;
}

export function spinWeekDayLabel(date: string): string {
  return formatTrainScheduleDateLabel(date);
}
