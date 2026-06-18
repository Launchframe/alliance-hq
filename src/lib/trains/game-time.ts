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

export function weekDatesFromMonday(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(weekStart, i));
}
