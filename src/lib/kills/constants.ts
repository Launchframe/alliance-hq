/** Sources persisted on commander_kills_events.source */
export type KillsEventSource =
  | "ashed_sync"
  | "discord"
  | "web"
  | "screenshot_ocr"
  | "officer_override"
  | "video_parse"
  | "roster_import"
  | "manual";

export const KILLS_ANOMALY_GAP = 50_000_000;
export const KILLS_ANOMALY_MIN_REPORTERS = 10;
export const KILLS_OFFICER_REVIEW_THRESHOLD = 2_000_000_000;

/** Upper bound for self-reported kill totals (Discord INTEGER-safe). */
export const KILLS_TOTAL_MAX = 50_000_000_000;

export const KILLS_PERCENTILE_WINDOWS = [30, 90, 180] as const;
export type KillsPercentileWindow = (typeof KILLS_PERCENTILE_WINDOWS)[number];

export function validateKillsTotal(total: number): boolean {
  return Number.isFinite(total) && total > 0 && total <= KILLS_TOTAL_MAX;
}
