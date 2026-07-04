/** In-house (Tesseract) OCR accuracy expectations per score target. */

export const OCR_ACCURACY_LEVELS = ["high", "mid", "low", "none"] as const;

export type VideoOcrAccuracy = (typeof OCR_ACCURACY_LEVELS)[number];

const ACCURACY_SET = new Set<string>(OCR_ACCURACY_LEVELS);

export function isVideoOcrAccuracy(value: unknown): value is VideoOcrAccuracy {
  return typeof value === "string" && ACCURACY_SET.has(value);
}

/**
 * Resolve pill label key and color classes for an in-house OCR accuracy level.
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
          "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      };
    case "mid":
      return {
        labelKey: "ocrAccuracy.mid",
        className: "border-amber-500/40 bg-amber-500/15 text-amber-300",
      };
    case "low":
      return {
        labelKey: "ocrAccuracy.low",
        className: "border-orange-500/40 bg-orange-500/15 text-orange-300",
      };
    case "none":
      return {
        labelKey: "ocrAccuracy.none",
        className: "border-[#484f58] bg-[#21262d] text-[#8b949e]",
      };
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}
