import {
  isRegularEventKey,
  SKY_GLACIER_ALLOWED_DOWS,
  type RegularEventKey,
} from "@/lib/regular-events/catalog.shared";
import type { RegularEventWeeklySlot } from "@/lib/regular-events/types.shared";
import {
  addCalendarDays,
  getServerDayOfWeek,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

export type ScheduleValidationCode =
  | "adjacent_days"
  | "min_gap_days"
  | "once_per_week"
  | "wed_fri_only"
  | "alternating_week"
  | "biweekly_phase"
  | "invalid_event";

export type ScheduleValidationResult =
  | { ok: true }
  | { ok: false; code: ScheduleValidationCode; eventKey: RegularEventKey };

/** Absolute day distance between two YYYY-MM-DD ST dates. */
export function calendarDayDistance(a: string, b: string): number {
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  let d = 0;
  let cursor = start;
  while (cursor < end) {
    cursor = addCalendarDays(cursor, 1);
    d += 1;
  }
  return d;
}

export function isBiweeklyOnWeek(
  weekMonday: string,
  phaseMonday: string,
): boolean {
  const earlier = weekMonday <= phaseMonday ? weekMonday : phaseMonday;
  const later = weekMonday <= phaseMonday ? phaseMonday : weekMonday;
  const weeks = calendarDayDistance(earlier, later) / 7;
  return weeks % 2 === 0;
}

/**
 * Alliance Exercise: no two dates on adjacent ST calendar days
 * (minimum distance 2 → at least one day between).
 */
export function validateAllianceExerciseDates(
  dates: readonly string[],
): ScheduleValidationResult {
  const sorted = [...new Set(dates)].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    if (calendarDayDistance(sorted[i - 1]!, sorted[i]!) < 2) {
      return {
        ok: false,
        code: "adjacent_days",
        eventKey: "marshal_guard",
      };
    }
  }
  return { ok: true };
}

/**
 * Zombie Siege: at least two full calendar days between occurrences
 * (distance ≥ 3, e.g. Mon → Thu).
 */
export function validateZombieSiegeDates(
  dates: readonly string[],
): ScheduleValidationResult {
  const sorted = [...new Set(dates)].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    if (calendarDayDistance(sorted[i - 1]!, sorted[i]!) < 3) {
      return {
        ok: false,
        code: "min_gap_days",
        eventKey: "zombie_siege",
      };
    }
  }
  return { ok: true };
}

/** Glacierdon / Sky Predator: at most one date per Mon–Sun ST week. */
export function validateOncePerWeekDates(
  eventKey: Extract<RegularEventKey, "glacierdon" | "sky_marshall">,
  dates: readonly string[],
): ScheduleValidationResult {
  const weeks = new Map<string, number>();
  for (const date of dates) {
    const week = getWeekStartMonday(date);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
    if ((weeks.get(week) ?? 0) > 1) {
      return { ok: false, code: "once_per_week", eventKey };
    }
  }
  return { ok: true };
}

export function validateWedFriOnly(
  eventKey: Extract<RegularEventKey, "glacierdon" | "sky_marshall">,
  dates: readonly string[],
): ScheduleValidationResult {
  const allowed = new Set<number>(SKY_GLACIER_ALLOWED_DOWS);
  for (const date of dates) {
    if (!allowed.has(getServerDayOfWeek(date))) {
      return { ok: false, code: "wed_fri_only", eventKey };
    }
  }
  return { ok: true };
}

export function validateSkyGlacierAlternating(
  skyDates: readonly string[],
  glacierdonDates: readonly string[],
): ScheduleValidationResult {
  const skyWeeks = new Set(skyDates.map((d) => getWeekStartMonday(d)));
  for (const date of glacierdonDates) {
    if (skyWeeks.has(getWeekStartMonday(date))) {
      return {
        ok: false,
        code: "alternating_week",
        eventKey: "glacierdon",
      };
    }
  }
  return { ok: true };
}

/** Expand weekly DOW slots into ST dates in [rangeStart, rangeEnd] inclusive. */
export function expandWeeklySlotsToDates(
  slots: readonly RegularEventWeeklySlot[],
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const dowSet = new Set(slots.map((s) => s.dow));
  const out: string[] = [];
  let cursor = rangeStart;
  while (cursor <= rangeEnd) {
    if (dowSet.has(getServerDayOfWeek(cursor))) {
      out.push(cursor);
    }
    cursor = addCalendarDays(cursor, 1);
  }
  return out;
}

export function expandBiweeklySlotsToDates(
  slots: readonly RegularEventWeeklySlot[],
  phaseMonday: string,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  return expandWeeklySlotsToDates(slots, rangeStart, rangeEnd).filter((date) =>
    isBiweeklyOnWeek(getWeekStartMonday(date), phaseMonday),
  );
}

export function expandOneShotDatesInRange(
  dates: readonly string[],
  rangeStart: string,
  rangeEnd: string,
): string[] {
  return [...new Set(dates)]
    .filter((d) => d >= rangeStart && d <= rangeEnd)
    .sort();
}

/**
 * Project interval_after_last dates into a window using the same step as
 * occurrence materialization (first on/after rangeStart, then +intervalDays).
 */
export function expandIntervalDatesInRange(input: {
  intervalDays: number;
  rangeStart: string;
  rangeEnd: string;
  lastOccurrenceDate?: string | null;
}): string[] {
  const step = Math.max(1, Math.floor(input.intervalDays));
  const out: string[] = [];
  let cursor: string;
  if (input.lastOccurrenceDate && input.lastOccurrenceDate < input.rangeStart) {
    cursor = addCalendarDays(input.lastOccurrenceDate, step);
    while (cursor < input.rangeStart) {
      cursor = addCalendarDays(cursor, step);
    }
  } else if (
    input.lastOccurrenceDate &&
    input.lastOccurrenceDate >= input.rangeStart
  ) {
    cursor = addCalendarDays(input.lastOccurrenceDate, step);
  } else {
    cursor = input.rangeStart;
  }
  while (cursor <= input.rangeEnd) {
    out.push(cursor);
    cursor = addCalendarDays(cursor, step);
  }
  return out;
}

export function validateEventScheduleDates(
  eventKey: string,
  dates: readonly string[],
): ScheduleValidationResult {
  if (!isRegularEventKey(eventKey)) {
    return {
      ok: false,
      code: "invalid_event",
      eventKey: "zombie_siege",
    };
  }
  switch (eventKey) {
    case "marshal_guard":
      return validateAllianceExerciseDates(dates);
    case "zombie_siege":
      return validateZombieSiegeDates(dates);
    case "glacierdon":
    case "sky_marshall": {
      const wedFri = validateWedFriOnly(eventKey, dates);
      if (!wedFri.ok) return wedFri;
      return validateOncePerWeekDates(eventKey, dates);
    }
    default: {
      const _exhaustive: never = eventKey;
      void _exhaustive;
      return { ok: true };
    }
  }
}

/** Validate weekly slots by expanding ~8 weeks of ST dates from an anchor Monday. */
export function validateWeeklySlotsForEvent(
  eventKey: RegularEventKey,
  slots: readonly RegularEventWeeklySlot[],
  anchorMonday: string,
): ScheduleValidationResult {
  const rangeEnd = addCalendarDays(anchorMonday, 7 * 8 - 1);
  const dates = expandWeeklySlotsToDates(slots, anchorMonday, rangeEnd);
  return validateEventScheduleDates(eventKey, dates);
}

export function validateBiweeklySlotsForEvent(
  eventKey: RegularEventKey,
  slots: readonly RegularEventWeeklySlot[],
  phaseMonday: string | null | undefined,
  anchorMonday: string,
): ScheduleValidationResult {
  if (!phaseMonday || !/^\d{4}-\d{2}-\d{2}$/.test(phaseMonday)) {
    return {
      ok: false,
      code: "biweekly_phase",
      eventKey: isRegularEventKey(eventKey) ? eventKey : "zombie_siege",
    };
  }
  const rangeEnd = addCalendarDays(anchorMonday, 7 * 8 - 1);
  const dates = expandBiweeklySlotsToDates(
    slots,
    phaseMonday,
    anchorMonday,
    rangeEnd,
  );
  return validateEventScheduleDates(eventKey, dates);
}

export function toggleDowInWeeklySlots(
  slots: readonly RegularEventWeeklySlot[],
  dow: number,
  timeSt: string,
): RegularEventWeeklySlot[] {
  const has = slots.some((s) => s.dow === dow);
  if (has) {
    return slots.filter((s) => s.dow !== dow);
  }
  return [...slots, { dow, timeSt }].sort((a, b) => a.dow - b.dow);
}

export function toggleOneShotDate(
  dates: readonly string[],
  date: string,
): string[] {
  const set = new Set(dates);
  if (set.has(date)) set.delete(date);
  else set.add(date);
  return [...set].sort();
}
