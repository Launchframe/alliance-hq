/** Server age in calendar days (cpt-hedge r() — UTC dates with 2h offset). */
export function serverAgeDays(openTimestampMs: number, now = new Date()): number {
  const open = new Date(openTimestampMs);
  const openAdjusted = new Date(open.getTime() - 2 * 60 * 60 * 1000);
  const nowAdjusted = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const openDay = Date.UTC(
    openAdjusted.getUTCFullYear(),
    openAdjusted.getUTCMonth(),
    openAdjusted.getUTCDate(),
  );
  const nowDay = Date.UTC(
    nowAdjusted.getUTCFullYear(),
    nowAdjusted.getUTCMonth(),
    nowAdjusted.getUTCDate(),
  );
  return Math.floor((nowDay - openDay) / 86_400_000) + 1;
}

/**
 * Age-based season from cpt-hedge fallback (caps at season 4).
 * Seasons 5+ require cpt-hedge sync or owner override.
 */
export function seasonFromServerAge(ageDays: number): number {
  if (ageDays <= 120) return 0;
  if (ageDays <= 176) return 1;
  if (ageDays <= 260) return 2;
  if (ageDays <= 351) return 3;
  return 4;
}

export function seasonKeyFromAge(openTimestampMs: number, now = new Date()): string {
  return String(seasonFromServerAge(serverAgeDays(openTimestampMs, now)));
}
