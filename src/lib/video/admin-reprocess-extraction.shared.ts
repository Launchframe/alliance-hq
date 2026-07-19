import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import { DEFAULT_PRIMARY_PASS } from "@/lib/video/pass-definitions";

/** Simple Increase/Decrease notches for admin reprocess. */
export const ADMIN_REPROCESS_FPS_LADDER = [1, 1.5, 2, 3, 4, 6] as const;

export type AdminReprocessFpsAdjustment = "keep" | "increase" | "decrease";

export type AdminReprocessExtractionRequest = {
  adjustment?: AdminReprocessFpsAdjustment;
  extraction?: ExtractionConfig;
  parseConfigId?: string;
};

export function isAdminReprocessFpsAdjustment(
  value: unknown,
): value is AdminReprocessFpsAdjustment {
  return value === "keep" || value === "increase" || value === "decrease";
}

export function normalizeExtractionConfig(
  raw: unknown,
): ExtractionConfig | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const mode = record.mode;
  if (mode !== "fps" && mode !== "scene") {
    return null;
  }
  const sampleFps =
    typeof record.sampleFps === "number" &&
    Number.isFinite(record.sampleFps) &&
    record.sampleFps > 0
      ? record.sampleFps
      : undefined;
  const sceneThreshold =
    typeof record.sceneThreshold === "number" &&
    Number.isFinite(record.sceneThreshold) &&
    record.sceneThreshold > 0
      ? record.sceneThreshold
      : undefined;

  if (mode === "fps") {
    if (sampleFps == null) return null;
    return { mode: "fps", sampleFps };
  }
  return {
    mode: "scene",
    sceneThreshold: sceneThreshold ?? DEFAULT_PRIMARY_PASS.sceneThreshold,
    sampleFps: sampleFps ?? DEFAULT_PRIMARY_PASS.sampleFps,
  };
}

export function extractionConfigsEqual(
  a: ExtractionConfig,
  b: ExtractionConfig,
): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "fps") {
    return a.sampleFps === b.sampleFps;
  }
  return (
    a.sceneThreshold === b.sceneThreshold && a.sampleFps === b.sampleFps
  );
}

export function passKeyForExtractionConfig(config: ExtractionConfig): string {
  if (config.mode === "fps") {
    const fps = config.sampleFps ?? 1;
    const label = Number.isInteger(fps) ? String(fps) : String(fps);
    return `fps_${label}`;
  }
  const threshold = config.sceneThreshold ?? 0.25;
  const label = Number.isInteger(threshold)
    ? String(threshold)
    : String(threshold);
  return `scene_${label}`;
}

/** Short English summary for dialog body (i18n interpolates separately). */
export function summarizeExtractionConfig(config: ExtractionConfig): string {
  if (config.mode === "fps") {
    const fps = config.sampleFps ?? 1;
    return `${fps} frames per second`;
  }
  const threshold = config.sceneThreshold ?? 0.25;
  return `scene threshold ${threshold}`;
}

export function nearestFpsLadderIndex(fps: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ADMIN_REPROCESS_FPS_LADDER.length; i += 1) {
    const dist = Math.abs(ADMIN_REPROCESS_FPS_LADDER[i]! - fps);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Next denser / sparser ladder notch strictly beyond current fps. */
export function stepFpsLadder(
  fps: number,
  direction: "increase" | "decrease",
): number | null {
  if (direction === "increase") {
    for (const notch of ADMIN_REPROCESS_FPS_LADDER) {
      if (notch > fps + 1e-9) return notch;
    }
    return null;
  }
  for (let i = ADMIN_REPROCESS_FPS_LADDER.length - 1; i >= 0; i -= 1) {
    const notch = ADMIN_REPROCESS_FPS_LADDER[i]!;
    if (notch < fps - 1e-9) return notch;
  }
  return null;
}

export function canIncreaseFps(fps: number): boolean {
  return stepFpsLadder(fps, "increase") != null;
}

export function canDecreaseFps(fps: number): boolean {
  return stepFpsLadder(fps, "decrease") != null;
}

/**
 * FPS value used for simple ladder Increase/Decrease availability.
 *
 * - fps mode: uses the stamped sampleFps directly (off-ladder values step
 *   strictly to the next notch via {@link stepFpsLadder}).
 * - scene mode: snaps to the nearest ladder notch first, then steps — so a
 *   scene job at sampleFps 1.8 increase becomes fps_3 (nearest 2 → step 3),
 *   not fps_2. Intentional densify bias when leaving scene capture.
 */
export function simpleLadderBaseFps(current: ExtractionConfig): number {
  if (current.mode === "fps") {
    return current.sampleFps ?? 2;
  }
  const startFps = current.sampleFps ?? 2;
  return ADMIN_REPROCESS_FPS_LADDER[nearestFpsLadderIndex(startFps)]!;
}

/**
 * Resolve the extraction config for a simple Keep / Increase / Decrease choice.
 * Scene-mode Increase/Decrease switches onto the FPS ladder (nearest notch, then step).
 */
export function resolveSimpleReprocessExtraction(
  current: ExtractionConfig | null,
  adjustment: AdminReprocessFpsAdjustment,
): { config: ExtractionConfig; changed: boolean } {
  const base = current ?? DEFAULT_PRIMARY_PASS;

  if (adjustment === "keep") {
    return { config: base, changed: false };
  }

  const startFps = simpleLadderBaseFps(base);
  const nextFps = stepFpsLadder(startFps, adjustment);
  if (nextFps == null) {
    return { config: base, changed: false };
  }

  const config: ExtractionConfig = { mode: "fps", sampleFps: nextFps };
  return {
    config,
    changed: !extractionConfigsEqual(base, config),
  };
}

/**
 * Resolve the target extraction for an admin reprocess request.
 * Advanced `extraction` wins over simple `adjustment` (default keep).
 */
export function resolveAdminReprocessExtraction(params: {
  current: ExtractionConfig | null;
  adjustment?: AdminReprocessFpsAdjustment;
  extraction?: ExtractionConfig | null;
}): {
  config: ExtractionConfig;
  changed: boolean;
  source: AdminReprocessFpsAdjustment | "advanced";
} {
  if (params.extraction) {
    const base = params.current ?? DEFAULT_PRIMARY_PASS;
    return {
      config: params.extraction,
      changed: !extractionConfigsEqual(base, params.extraction),
      source: "advanced",
    };
  }
  const adjustment = params.adjustment ?? "keep";
  const resolved = resolveSimpleReprocessExtraction(params.current, adjustment);
  return { ...resolved, source: adjustment };
}

export function adHocReprocessCampaignName(scoreTarget: string): string {
  return `Ad-hoc reprocess · ${scoreTarget}`;
}
