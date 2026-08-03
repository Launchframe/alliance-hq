import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";

export type WhoIsAwayWhen = "today" | "week";

export function parseWhoIsAwayWhen(value: string | undefined): WhoIsAwayWhen {
  return value?.trim().toLowerCase() === "week" ? "week" : "today";
}

/** Server-calendar range covering today, or the current Mon–Sun server week. */
export function resolveWhoIsAwayRange(
  today: string,
  when: WhoIsAwayWhen,
): { rangeStart: string; rangeEnd: string } {
  if (when === "week") {
    const monday = getWeekStartMonday(today);
    return { rangeStart: monday, rangeEnd: addCalendarDays(monday, 6) };
  }
  return { rangeStart: today, rangeEnd: today };
}

/**
 * Picks a single linked commander by (case-insensitive) display name.
 * Returns null when there is no match or more than one match.
 */
export function matchLinkedCommanderByName<
  T extends { memberDisplayName: string | null },
>(links: T[], commanderName: string | undefined): T | null {
  const needle = commanderName?.trim().toLowerCase();
  if (!needle) return null;
  const matches = links.filter(
    (link) => link.memberDisplayName?.trim().toLowerCase() === needle,
  );
  return matches.length === 1 ? matches[0]! : null;
}
