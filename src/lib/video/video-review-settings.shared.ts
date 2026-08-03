export const VIDEO_REVIEW_SETTINGS_STORAGE_KEY = "hq-video-review-settings-v1";

export type VideoReviewSettings = {
  fillMissingDepositTimes: boolean;
  fillMissingDepositAmounts: boolean;
};

export const DEFAULT_VIDEO_REVIEW_SETTINGS: VideoReviewSettings = {
  fillMissingDepositTimes: true,
  fillMissingDepositAmounts: true,
};

export function parseVideoReviewSettings(raw: string): VideoReviewSettings | null {
  try {
    const parsed = JSON.parse(raw) as Partial<VideoReviewSettings>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      fillMissingDepositTimes:
        parsed.fillMissingDepositTimes !== false,
      fillMissingDepositAmounts:
        parsed.fillMissingDepositAmounts !== false,
    };
  } catch {
    return null;
  }
}

export function readVideoReviewSettings(): VideoReviewSettings {
  if (typeof window === "undefined") {
    return DEFAULT_VIDEO_REVIEW_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(VIDEO_REVIEW_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_VIDEO_REVIEW_SETTINGS;
    return parseVideoReviewSettings(raw) ?? DEFAULT_VIDEO_REVIEW_SETTINGS;
  } catch {
    return DEFAULT_VIDEO_REVIEW_SETTINGS;
  }
}

export function writeVideoReviewSettings(settings: VideoReviewSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      VIDEO_REVIEW_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // quota / private mode
  }
}
