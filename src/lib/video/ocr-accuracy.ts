/** In-house (Tesseract) OCR accuracy expectations per score target. */

export const OCR_ACCURACY_LEVELS = ["high", "mid", "low", "none"] as const;

export type VideoOcrAccuracy = (typeof OCR_ACCURACY_LEVELS)[number];

const ACCURACY_SET = new Set<string>(OCR_ACCURACY_LEVELS);

export function isVideoOcrAccuracy(value: unknown): value is VideoOcrAccuracy {
  return typeof value === "string" && ACCURACY_SET.has(value);
}

/**
 * Ashed OCR is treated as High for every Ashed-supported score target when
 * the session has a live Ashed credential. Native-only targets (e.g. deposit
 * slips) keep their in-house rating.
 */
export function displayOcrAccuracy(input: {
  inHouseOcrAccuracy: VideoOcrAccuracy;
  ashedCredentialsActive: boolean;
  ashedSupported: boolean;
}): VideoOcrAccuracy {
  if (input.ashedCredentialsActive && input.ashedSupported) {
    return "high";
  }
  return input.inHouseOcrAccuracy;
}

/**
 * Resolve pill label key and color classes for an OCR accuracy level.
 * Client-safe — no server imports.
 */
export function resolveOcrAccuracyBadge(level: VideoOcrAccuracy): {
  labelKey: `ocrAccuracy.${VideoOcrAccuracy}`;
  className: string;
} {
  switch (level) {
    case "high":
      return {
        labelKey: "ocrAccuracy.high",
        className:
          "border-emerald-700/50 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300",
      };
    case "mid":
      return {
        labelKey: "ocrAccuracy.mid",
        className:
          "border-amber-700/50 bg-amber-500/15 text-amber-900 dark:border-amber-500/40 dark:text-amber-300",
      };
    case "low":
      return {
        labelKey: "ocrAccuracy.low",
        className:
          "border-orange-700/50 bg-orange-500/15 text-orange-900 dark:border-orange-500/40 dark:text-orange-300",
      };
    case "none":
      return {
        labelKey: "ocrAccuracy.none",
        className:
          "border-hq-border bg-hq-surface-muted text-hq-fg-muted",
      };
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}
