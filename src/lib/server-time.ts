/**
 * The game runs on fixed UTC−02:00 ("Server Time") with no daylight saving.
 * Store timestamps in UTC; interpret calendar dates and display times in Server Time.
 */
export const SERVER_TIME_IANA = "Etc/GMT+2" as const;
export const SERVER_TIME_UTC_OFFSET = "-02:00";

/** Start of a Server Time calendar day (00:00:00.000), as UTC. */
export function serverCalendarDateToUtcStart(
  date: string,
): Date | undefined {
  if (!date.trim()) {
    return undefined;
  }
  const parsed = new Date(`${date}T00:00:00.000${SERVER_TIME_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** End of a Server Time calendar day (23:59:59.999), as UTC. */
export function serverCalendarDateToUtcEnd(date: string): Date | undefined {
  if (!date.trim()) {
    return undefined;
  }
  const parsed = new Date(`${date}T23:59:59.999${SERVER_TIME_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatServerDateTime(
  value: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    timeZone: SERVER_TIME_IANA,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    ...options,
  }).format(date);
}
