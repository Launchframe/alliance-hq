/** Parse YYYY-MM-DD at noon server offset (-02:00) for stable day math. */
function calendarDateToMs(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00.000-02:00`).getTime();
}

/** Whole calendar days from `fromDate` up to but not including `toDate`. */
export function diffCalendarDays(fromDate: string, toDate: string): number {
  const ms = calendarDateToMs(toDate) - calendarDateToMs(fromDate);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
