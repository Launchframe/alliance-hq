/**
 * Most recent locked conductor date strictly before `beforeDate` (ISO date).
 * When `beforeDate` is omitted, returns the latest locked date.
 * Used so "Last conducted" never echoes the day currently on the wheel/card.
 */
export function resolveConductorLastConductedDate(
  lockedDatesNewestFirst: readonly string[],
  beforeDate?: string | null,
): string | null {
  for (const date of lockedDatesNewestFirst) {
    if (beforeDate == null || date < beforeDate) {
      return date;
    }
  }
  return null;
}
