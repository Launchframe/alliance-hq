export function isPreviewOrOptimisticDayConfigId(id: string): boolean {
  return id.startsWith("preview-") || id.startsWith("optimistic-");
}

/** True when the week has a saved schedule row or persisted day configs (not preview-only). */
export function weekHasPersistedSchedule(
  schedule: { weekStart: string } | null,
  weekStart: string,
  dayConfigs: Array<{ id: string }>,
): boolean {
  if (schedule && schedule.weekStart === weekStart) return true;
  return dayConfigs.some((day) => !isPreviewOrOptimisticDayConfigId(day.id));
}

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
