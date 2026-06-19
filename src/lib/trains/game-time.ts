import { SERVER_TIME_IANA } from "@/lib/timezone/constants";

/** Current calendar date in game server time (UTC-2), YYYY-MM-DD. */
export function getServerCalendarDate(now = new Date()): string {
  return formatServerCalendarDate(now);
}

export function formatServerCalendarDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVER_TIME_IANA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** Day of week 0=Sun … 6=Sat in server time. */
export function getServerDayOfWeek(dateStr: string): number {
  const anchor = new Date(`${dateStr}T12:00:00.000-02:00`);
  return anchor.getUTCDay();
}

/** Monday YYYY-MM-DD of the week containing dateStr (server calendar). */
export function getWeekStartMonday(dateStr: string): string {
  const dow = getServerDayOfWeek(dateStr);
  const offset = dow === 0 ? -6 : 1 - dow;
  const anchor = new Date(`${dateStr}T12:00:00.000-02:00`);
  anchor.setUTCDate(anchor.getUTCDate() + offset);
  return formatServerCalendarDate(anchor);
}

export function addCalendarDays(dateStr: string, days: number): string {
  const anchor = new Date(`${dateStr}T12:00:00.000-02:00`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return formatServerCalendarDate(anchor);
}

/** YYYY-MM-DD compare (server calendar strings). */
export function isCalendarDateOnOrAfter(
  date: string,
  start: string,
): boolean {
  return date >= start;
}

export function weekDatesFromMonday(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
}

/** YYYY-MM for a server calendar date. */
export function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** First calendar day of month (YYYY-MM-01). */
export function monthStartFromKey(monthKey: string): string {
  return `${monthKey}-01`;
}

/** Last calendar day of month in server time. */
export function monthEndFromKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

/** Shift month key by delta months (returns YYYY-MM). */
export function addCalendarMonths(monthKey: string, delta: number): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const anchor = new Date(
    Date.UTC(Number(yearStr), Number(monthStr) - 1 + delta, 1, 12),
  );
  const year = anchor.getUTCFullYear();
  const month = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export type MonthGridCell = {
  date: string;
  inMonth: boolean;
};

/** Monday-start grid covering the month (42 cells = 6 weeks). */
export function buildMonthGrid(monthKey: string): MonthGridCell[] {
  const monthStart = monthStartFromKey(monthKey);
  const monthEnd = monthEndFromKey(monthKey);
  const gridStart = getWeekStartMonday(monthStart);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addCalendarDays(gridStart, i);
    return {
      date,
      inMonth: date >= monthStart && date <= monthEnd,
    };
  });
}

/** Pivot window: Mon 22:00 – Tue 12:00 server time (UTC−2). */
export function isWithinPivotWindow(now = new Date()): boolean {
  const dateStr = formatServerCalendarDate(now);
  const dow = getServerDayOfWeek(dateStr);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SERVER_TIME_IANA,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  if (dow === 1 && hour >= 22) return true;
  if (dow === 2 && hour < 12) return true;
  return false;
}
