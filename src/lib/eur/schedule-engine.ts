import {
  addCalendarDays,
  getServerCalendarDate,
  getServerDayOfWeek,
} from "@/lib/trains/game-time";

export type EurWeeklySlot = {
  dow: number;
  timeSt: string;
};

export type EurOccurrenceSlot = {
  occurrenceDate: string;
  scheduledStartAt: Date;
};

const ST_OFFSET = "-02:00";

export function parseTimeSt(timeSt: string): { hours: number; minutes: number } {
  const [h, m] = timeSt.split(":");
  return {
    hours: Number.parseInt(h ?? "0", 10) || 0,
    minutes: Number.parseInt(m ?? "0", 10) || 0,
  };
}

export function serverTimestampFromCalendarAndTime(
  dateStr: string,
  timeSt: string,
): Date {
  const { hours, minutes } = parseTimeSt(timeSt);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:${mm}:00.000${ST_OFFSET}`);
}

export function reminderAt(
  scheduledStartAt: Date,
  delayMinutes: number,
): Date {
  return new Date(scheduledStartAt.getTime() + delayMinutes * 60 * 1000);
}

export function computeWeeklyOccurrencesInWindow(
  slots: EurWeeklySlot[],
  windowStart: Date,
  windowEnd: Date,
): EurOccurrenceSlot[] {
  if (slots.length === 0) return [];

  const results: EurOccurrenceSlot[] = [];
  let dateStr = getServerCalendarDate(windowStart);
  const endDateStr = getServerCalendarDate(windowEnd);

  while (dateStr <= endDateStr) {
    const dow = getServerDayOfWeek(dateStr);
    for (const slot of slots) {
      if (slot.dow !== dow) continue;
      const scheduledStartAt = serverTimestampFromCalendarAndTime(
        dateStr,
        slot.timeSt,
      );
      if (scheduledStartAt >= windowStart && scheduledStartAt <= windowEnd) {
        results.push({ occurrenceDate: dateStr, scheduledStartAt });
      }
    }
    dateStr = addCalendarDays(dateStr, 1);
  }

  return results;
}

export function computeNextIntervalOccurrence(
  lastScheduledStartAt: Date | null,
  intervalDays: number,
  anchorTimeSt: string,
  windowStart: Date,
  windowEnd: Date,
): EurOccurrenceSlot | null {
  if (intervalDays < 1) return null;

  const anchorDate = lastScheduledStartAt
    ? getServerCalendarDate(lastScheduledStartAt)
    : getServerCalendarDate(windowStart);

  let candidateDate = lastScheduledStartAt
    ? addCalendarDays(anchorDate, intervalDays)
    : anchorDate;

  let scheduledStartAt = serverTimestampFromCalendarAndTime(
    candidateDate,
    anchorTimeSt,
  );

  let guard = 0;
  while (scheduledStartAt < windowStart && guard < 366) {
    candidateDate = addCalendarDays(candidateDate, intervalDays);
    scheduledStartAt = serverTimestampFromCalendarAndTime(
      candidateDate,
      anchorTimeSt,
    );
    guard += 1;
  }

  if (scheduledStartAt > windowEnd) return null;

  return { occurrenceDate: candidateDate, scheduledStartAt };
}

/** Nth weekday of month in server calendar (nth 1 = first). */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  nth: number,
  dow: number,
): string | null {
  let count = 0;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  let dateStr = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  for (let day = 1; day <= lastDay; day += 1) {
    dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
    if (getServerDayOfWeek(dateStr) === dow) {
      count += 1;
      if (count === nth) return dateStr;
    }
  }
  return null;
}
