/** Sources persisted on commander_thp_events.source */
export type ThpEventSource =
  | "ashed_sync"
  | "discord"
  | "web"
  | "screenshot_ocr"
  | "officer_override"
  | "video_parse"
  | "roster_import"
  | "manual";

export const THP_ANOMALY_GAP = 5_000_000;
export const THP_ANOMALY_MIN_REPORTERS = 10;
export const THP_OFFICER_REVIEW_THRESHOLD = 200_000_000;

export const THP_PERCENTILE_WINDOWS = [30, 90, 180] as const;
export type ThpPercentileWindow = (typeof THP_PERCENTILE_WINDOWS)[number];
