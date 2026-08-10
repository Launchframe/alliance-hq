import { diffCalendarDays } from "@/lib/trains/calendar-date-diff.shared";

export type RelativeConductorConductLabels = {
  today: string;
  yesterday: string;
  daysAgo: (count: number) => string;
  weeksAgo: (count: number) => string;
  monthsAgo: (count: number) => string;
  yearsAgo: (count: number) => string;
  never: string;
};

/** Relative "last conducted" label from server calendar dates. */
export function formatRelativeConductorLastConducted(
  lastConductedDate: string | null | undefined,
  referenceDate: string,
  labels: RelativeConductorConductLabels,
): string {
  if (!lastConductedDate) return labels.never;

  const diffDays = diffCalendarDays(lastConductedDate, referenceDate);
  if (diffDays <= 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  if (diffDays < 7) return labels.daysAgo(diffDays);

  const weeks = Math.floor(diffDays / 7);
  if (diffDays < 30) return labels.weeksAgo(weeks);

  const months = Math.floor(diffDays / 30);
  if (diffDays < 365) return labels.monthsAgo(months);

  const years = Math.floor(diffDays / 365);
  return labels.yearsAgo(years);
}
