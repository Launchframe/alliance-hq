export function latestLockedDateInWeek(
  records: Array<{ date: string; lockedAt?: string | null }>,
  weekStart: string,
  weekEnd: string,
): string | null {
  let latest: string | null = null;

  for (const record of records) {
    if (!record.lockedAt) continue;
    if (record.date < weekStart || record.date > weekEnd) continue;
    if (latest == null || record.date > latest) {
      latest = record.date;
    }
  }

  return latest;
}

export function formatTrainScheduleDateLabel(date: string): string {
  const anchor = new Date(`${date}T12:00:00-02:00`);
  return anchor.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "Etc/GMT+2",
  });
}
