/** Locale-formatted kills total for Discord bot replies. */
export function formatKillsTotalForDiscord(total: number): string {
  return total.toLocaleString();
}

/** Reported lifetime kills; null when the commander has not reported any. */
export function commanderKillsTotal(commander: {
  currentKills?: number | null;
}): number | null {
  const value = commander.currentKills;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return null;
}

export function formatKillsDisplay(
  total: number | null | undefined,
  locale: string,
): string {
  if (total == null || total <= 0) return "—";
  return total.toLocaleString(locale);
}
