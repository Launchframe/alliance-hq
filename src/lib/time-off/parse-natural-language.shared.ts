import {
  addCalendarDays,
  getServerCalendarDate,
  getServerDayOfWeek,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

import type { TimeOffAvailability } from "@/lib/time-off/types.shared";

export type ParsedTimeOffRange = {
  startDate: string;
  endDate: string;
  notes: string;
  availability: TimeOffAvailability;
};

export type ParseTimeOffMessageResult =
  | { ok: true; parsed: ParsedTimeOffRange }
  | { ok: false; error: "empty" | "unrecognized" };

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseIsoDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function nextWeekdayDate(
  today: string,
  targetDow: number,
  includeToday = false,
): string {
  const currentDow = getServerDayOfWeek(today);
  let delta = targetDow - currentDow;
  if (delta < 0 || (delta === 0 && !includeToday)) {
    delta += 7;
  }
  return addCalendarDays(today, delta);
}

function weekRangeFromMonday(monday: string): { start: string; end: string } {
  return { start: monday, end: addCalendarDays(monday, 6) };
}

function detectAvailability(text: string): TimeOffAvailability {
  const lower = text.toLowerCase();
  if (/\b(hit and miss|hit-or-miss|hit & miss)\b/.test(lower)) {
    return "hit_and_miss";
  }
  if (/\b(minimums?|maintain minimums?)\b/.test(lower)) {
    return "minimums";
  }
  if (
    /\b(limited|partial|part[- ]time|might log in|may log in|offline most of the day)\b/.test(
      lower,
    )
  ) {
    return "limited";
  }
  return "full_away";
}

function stripAvailabilityPhrases(text: string): string {
  return text
    .replace(/\b(hit and miss|hit-or-miss|hit & miss)\b/gi, "")
    .replace(/\b(maintain )?minimums?\b/gi, "")
    .replace(
      /\b(limited availability|partial availability|might log in|may log in|offline most of the day)\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseMonthDay(
  monthToken: string,
  dayToken: string,
  today: string,
  options?: { explicitMonth?: boolean },
): string | null {
  const month = MONTH_NAMES[monthToken.toLowerCase()];
  const day = Number(dayToken);
  if (!month || !Number.isFinite(day) || day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  const candidate = formatYmd(year, month, day);
  if (!options?.explicitMonth && candidate < today) {
    return formatYmd(year + 1, month, day);
  }
  return candidate;
}

function tryExplicitIsoRange(
  text: string,
): { start: string; end: string } | null {
  const isoRange = text.match(
    /(\d{4}-\d{2}-\d{2})\s*(?:to|through|thru|-|–)\s*(\d{4}-\d{2}-\d{2})/i,
  );
  if (isoRange) {
    const start = parseIsoDate(isoRange[1]);
    const end = parseIsoDate(isoRange[2]);
    if (start && end && start <= end) return { start, end };
  }
  return null;
}

function tryNamedMonthRange(
  text: string,
  today: string,
): { start: string; end: string } | null {
  const namedRange = text.match(
    /\b([A-Za-z]+)\s+(\d{1,2})\s*(?:to|through|thru|-|–)\s*(\d{1,2})\b/i,
  );
  if (namedRange) {
    const start = parseMonthDay(namedRange[1], namedRange[2], today, {
      explicitMonth: true,
    });
    const end = parseMonthDay(namedRange[1], namedRange[3], today, {
      explicitMonth: true,
    });
    if (start && end) {
      return { start, end: end < start ? addCalendarDays(start, 7) : end };
    }
  }

  const crossMonth = text.match(
    /\b([A-Za-z]+)\s+(\d{1,2})\s*(?:to|through|thru|-|–)\s*([A-Za-z]+)\s+(\d{1,2})\b/i,
  );
  if (crossMonth) {
    const start = parseMonthDay(crossMonth[1], crossMonth[2], today, {
      explicitMonth: true,
    });
    const end = parseMonthDay(crossMonth[3], crossMonth[4], today, {
      explicitMonth: true,
    });
    if (start && end) return { start, end };
  }
  return null;
}

function tryRelativePhrases(
  text: string,
  today: string,
): { start: string; end: string } | null {
  const lower = text.toLowerCase();

  if (/\b(next|upcoming)\s+week\b/.test(lower) || /\bthis upcoming week\b/.test(lower)) {
    const nextMonday = addCalendarDays(getWeekStartMonday(today), 7);
    return weekRangeFromMonday(nextMonday);
  }

  if (/\bthis week\b/.test(lower)) {
    return weekRangeFromMonday(getWeekStartMonday(today));
  }

  if (/\b(next|upcoming)\s+weekend\b/.test(lower)) {
    const saturday = nextWeekdayDate(today, 6);
    return { start: saturday, end: addCalendarDays(saturday, 1) };
  }

  if (/\bthis weekend\b/.test(lower)) {
    const saturday = nextWeekdayDate(today, 6, true);
    if (getServerDayOfWeek(today) === 0) {
      return { start: addCalendarDays(today, -1), end: today };
    }
    return { start: saturday, end: addCalendarDays(saturday, 1) };
  }

  const durationWeeks = lower.match(
    /\b(?:for\s+)?(?:the\s+)?next\s+(\d+|one|two|three|four)\s+weeks?\b/,
  );
  if (durationWeeks) {
    const count = wordToNumber(durationWeeks[1]) ?? 1;
    return { start: today, end: addCalendarDays(today, count * 7 - 1) };
  }

  const twoWeeks = lower.match(/\b(?:for\s+)?(?:the\s+)?next\s+two\s+weeks\b/);
  if (twoWeeks) {
    return { start: today, end: addCalendarDays(today, 13) };
  }

  const oneWeek = lower.match(/\b(?:for\s+)?(?:a|one)\s+week\b/);
  if (oneWeek) {
    return { start: today, end: addCalendarDays(today, 6) };
  }

  const untilWeekend = lower.match(/\b(?:until|till|through)\s+this weekend\b/);
  if (untilWeekend) {
    const saturday = nextWeekdayDate(today, 6, true);
    return { start: today, end: addCalendarDays(saturday, 1) };
  }

  for (const [name, dow] of Object.entries(WEEKDAY_NAMES)) {
    const untilDay = lower.match(
      new RegExp(`\\b(?:until|till|through)\\s+${name}\\b`),
    );
    if (untilDay) {
      return { start: today, end: nextWeekdayDate(today, dow, true) };
    }
  }

  const tomorrow = lower.match(/\btomorrow\b/);
  if (tomorrow) {
    const day = addCalendarDays(today, 1);
    return { start: day, end: day };
  }

  const todayPhrase = lower.match(/\btoday\b/);
  if (todayPhrase) {
    return { start: today, end: today };
  }

  return null;
}

function wordToNumber(token: string): number | null {
  const map: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
  };
  if (map[token]) return map[token];
  const parsed = Number(token);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripDatePhrases(text: string): string {
  return text
    .replace(
      /\b(?:i(?:'ll| will)?\s+)?be\s+(?:away|out|offline|on\s+(?:vacation|holiday|leave))\b/gi,
      "",
    )
    .replace(/\b(?:i am|i'm)\s+(?:away|out|offline|on\s+(?:vacation|holiday|leave))\b/gi, "")
    .replace(/\bfor\s+the\s+next\s+(?:\d+|one|two|three|four)\s+weeks?\b/gi, "")
    .replace(/\b(?:this|next|upcoming)\s+week(?:end)?\b/gi, "")
    .replace(/\b(?:until|till|through)\s+(?:this weekend|\w+)\b/gi, "")
    .replace(/\b(?:from\s+)?[A-Za-z]+\s+\d{1,2}(?:\s*(?:to|through|-)\s*\d{1,2})?\b/gi, "")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:\s*(?:to|through|-)\s*\d{4}-\d{2}-\d{2})?\b/g, "")
    .replace(/^[,.;\s]+|[,.;\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Parse natural-language time-off announcements into server calendar dates.
 * Uses game server calendar (UTC−2) via `referenceDate`.
 */
export function parseTimeOffMessage(
  message: string,
  referenceDate = getServerCalendarDate(),
): ParseTimeOffMessageResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "empty" };
  }

  const availability = detectAvailability(trimmed);
  const working = stripAvailabilityPhrases(trimmed);

  const range =
    tryExplicitIsoRange(working) ??
    tryNamedMonthRange(working, referenceDate) ??
    tryRelativePhrases(working, referenceDate);

  if (!range) {
    return { ok: false, error: "unrecognized" };
  }

  const notes = stripDatePhrases(working);
  return {
    ok: true,
    parsed: {
      startDate: range.start,
      endDate: range.end,
      notes: notes.length > 0 ? notes : trimmed,
      availability,
    },
  };
}

/** True when `date` falls within an inclusive [startDate, endDate] range. */
export function isDateInTimeOffRange(
  date: string,
  startDate: string,
  endDate: string,
): boolean {
  return date >= startDate && date <= endDate;
}

/** Active entry: not cancelled and overlaps `date`. */
export function entryCoversDate(
  entry: { startDate: string; endDate: string; cancelledAt?: Date | string | null },
  date: string,
): boolean {
  if (entry.cancelledAt) return false;
  return isDateInTimeOffRange(date, entry.startDate, entry.endDate);
}
