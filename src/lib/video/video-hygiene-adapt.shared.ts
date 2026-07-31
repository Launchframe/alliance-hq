/**
 * Per uploader×scoreTarget denser-extraction bias for the hygiene learning loop.
 */

import {
  extractionConfigsEqual,
  passKeyForExtractionConfig,
  resolveSimpleReprocessExtraction,
} from "@/lib/video/admin-reprocess-extraction.shared";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";

const MIN_JOBS_FOR_ADAPT = 3;

export type AdaptBiasInput = {
  jobCount: number;
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
  scrollStyleCounts: Record<string, number>;
  /** Last known bias from adapt_bias_on/off events. */
  previouslyOn: boolean;
};

function dominantScrollStyle(
  counts: Record<string, number>,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [style, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  return best;
}

function isPoorHistory(input: AdaptBiasInput): boolean {
  const scroll = dominantScrollStyle(input.scrollStyleCounts);
  if (scroll === "chaotic" || scroll === "fast") return true;
  if (input.thumbsUpRate != null && input.thumbsUpRate < 0.5) return true;
  if (input.avgQualityScore != null && input.avgQualityScore < 0.5) {
    return true;
  }
  return false;
}

/** Strong enough to turn bias off (hysteresis vs turn-on thresholds). */
function isRecovered(input: AdaptBiasInput): boolean {
  const thumbsOk =
    input.thumbsUpRate == null || input.thumbsUpRate >= 0.7;
  const qualityOk =
    input.avgQualityScore == null || input.avgQualityScore >= 0.65;
  const scroll = dominantScrollStyle(input.scrollStyleCounts);
  const scrollOk = scroll !== "chaotic" && scroll !== "fast";
  return thumbsOk && qualityOk && scrollOk;
}

/**
 * Decide whether this uploader×target should get a denser primary overlay.
 * Thin history keeps the previous state to avoid flicker.
 */
export function shouldApplyDenseAdaptBias(input: AdaptBiasInput): boolean {
  if (input.jobCount < MIN_JOBS_FOR_ADAPT) {
    return input.previouslyOn;
  }
  if (input.previouslyOn) {
    return !isRecovered(input);
  }
  return isPoorHistory(input);
}

/**
 * Overlay denser extraction on the alliance/experiment primary without rewriting
 * alliance-wide assignments. One ladder step denser when possible.
 */
export function applyDenseAdaptOverlay(
  primary: ExtractionConfig,
): { config: ExtractionConfig; changed: boolean; passKey: string } {
  const denser = resolveSimpleReprocessExtraction(primary, "increase");
  if (!denser.changed) {
    return {
      config: primary,
      changed: false,
      passKey: passKeyForExtractionConfig(primary),
    };
  }
  return {
    config: denser.config,
    changed: !extractionConfigsEqual(primary, denser.config),
    passKey: passKeyForExtractionConfig(denser.config),
  };
}
