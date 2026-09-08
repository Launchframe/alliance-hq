import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";
import {
  expandBiweeklySlotsToDates,
  expandIntervalDatesInRange,
  expandOneShotDatesInRange,
  expandWeeklySlotsToDates,
} from "@/lib/regular-events/schedule-validation.shared";
import type { RegularEventRuleDto } from "@/lib/regular-events/settings.shared";
import type { RegularEventWeeklySlot } from "@/lib/regular-events/types.shared";
import {
  addCalendarDays,
  getMonthKey,
  getServerDayOfWeek,
  monthEndFromKey,
  monthStartFromKey,
} from "@/lib/trains/game-time";

export type RegularEventCalendarMarker = {
  date: string;
  eventKey: RegularEventKey | string;
  eventLabel: string;
  timeSt: string;
};

function timeForDate(
  rule: RegularEventRuleDto,
  date: string,
): string {
  if (rule.weeklySlots?.length) {
    const dow = getServerDayOfWeek(date);
    const slot = rule.weeklySlots.find((s) => s.dow === dow);
    if (slot) return slot.timeSt;
  }
  return rule.anchorTimeSt ?? "23:00";
}

export function expandRuleMarkersForRange(
  rules: readonly RegularEventRuleDto[],
  rangeStart: string,
  rangeEnd: string,
): RegularEventCalendarMarker[] {
  const markers: RegularEventCalendarMarker[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let dates: string[] = [];

    if (rule.scheduleKind === "weekly" && rule.weeklySlots?.length) {
      dates = expandWeeklySlotsToDates(
        rule.weeklySlots,
        rangeStart,
        rangeEnd,
      );
    } else if (
      rule.scheduleKind === "biweekly" &&
      rule.weeklySlots?.length &&
      rule.biweeklyPhaseMonday
    ) {
      dates = expandBiweeklySlotsToDates(
        rule.weeklySlots,
        rule.biweeklyPhaseMonday,
        rangeStart,
        rangeEnd,
      );
    } else if (rule.scheduleKind === "once" && rule.oneShotDates?.length) {
      dates = expandOneShotDatesInRange(
        rule.oneShotDates,
        rangeStart,
        rangeEnd,
      );
    } else if (
      rule.scheduleKind === "interval_after_last" &&
      rule.intervalDays
    ) {
      dates = expandIntervalDatesInRange({
        intervalDays: rule.intervalDays,
        rangeStart,
        rangeEnd,
      });
    }

    for (const date of dates) {
      markers.push({
        date,
        eventKey: rule.eventKey,
        eventLabel: rule.eventLabel,
        timeSt: timeForDate(rule, date),
      });
    }
  }
  return markers;
}

export function expandRuleMarkersForMonth(
  rules: readonly RegularEventRuleDto[],
  monthKey: string,
): RegularEventCalendarMarker[] {
  return expandRuleMarkersForRange(
    rules,
    monthStartFromKey(monthKey),
    monthEndFromKey(monthKey),
  );
}

export function expandRuleMarkersForWeek(
  rules: readonly RegularEventRuleDto[],
  weekStartMonday: string,
): RegularEventCalendarMarker[] {
  return expandRuleMarkersForRange(
    rules,
    weekStartMonday,
    addCalendarDays(weekStartMonday, 6),
  );
}

export function monthKeyFromDate(date: string): string {
  return getMonthKey(date);
}

/** Drop leading/trailing weeks that have no in-month days (keeps partial edge weeks). */
export function trimEmptyMonthGridWeeks<T extends { inMonth: boolean }>(
  cells: readonly T[],
): T[] {
  if (cells.length === 0) return [];
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push([...cells.slice(i, i + 7)]);
  }
  return weeks.filter((week) => week.some((cell) => cell.inMonth)).flat();
}

export function defaultTimeStForRule(rule: RegularEventRuleDto): string {
  if (rule.anchorTimeSt) return rule.anchorTimeSt;
  const first = rule.weeklySlots?.[0]?.timeSt;
  return first ?? "23:00";
}

export function slotsAfterTogglingDow(
  rule: RegularEventRuleDto,
  dow: number,
): RegularEventWeeklySlot[] {
  const timeSt = defaultTimeStForRule(rule);
  const current = rule.weeklySlots ?? [];
  const has = current.some((s) => s.dow === dow);
  if (has) return current.filter((s) => s.dow !== dow);
  return [...current, { dow, timeSt }].sort((a, b) => a.dow - b.dow);
}

export function applyTimeStToSlots(
  slots: readonly RegularEventWeeklySlot[],
  timeSt: string,
): RegularEventWeeklySlot[] {
  return slots.map((s) => ({ ...s, timeSt }));
}
