/**
 * Config validation and registry for roster OCR experiments.
 *
 * The `parse_configs` table stores config_json as an opaque JSONB blob.
 * For video passes this is `ExtractionConfig`; for roster OCR it is
 * `RosterOcrConfig` (mode: "roster-ocr").
 *
 * Admins create parse configs at /admin/parse-configs using passKey values like:
 *   roster_ocr_scale_2_psm_6   (default)
 *   roster_ocr_scale_3_psm_3   (upscale 3× + sparse text PSM)
 *
 * Experiments at /admin/experiments target scoreTarget = "member-roster-screenshot".
 * Variant arms select one of these parse configs; the control arm uses defaults.
 *
 * Usage note: these helpers are server-only (they import from @/lib/db).
 */

import "server-only";

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import {
  DEFAULT_ROSTER_OCR_CONFIG,
  ROSTER_OCR_SCORE_TARGET,
} from "@/lib/members/roster-ocr/types";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function isValidRosterOcrConfig(config: unknown): config is RosterOcrConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  if (c.mode !== "roster-ocr") return false;
  if (c.preprocessScale !== undefined && typeof c.preprocessScale !== "number") return false;
  if (c.tesseractPsm !== undefined && typeof c.tesseractPsm !== "number") return false;
  if (c.charWhitelist !== undefined && typeof c.charWhitelist !== "string") return false;
  if (c.minWordConfidence !== undefined && typeof c.minWordConfidence !== "number") return false;
  return true;
}

/** Human-readable pass key generator for UI convenience. */
export function rosterOcrPassKey(config: RosterOcrConfig): string {
  const scale = config.preprocessScale ?? DEFAULT_ROSTER_OCR_CONFIG.preprocessScale;
  const psm = config.tesseractPsm ?? DEFAULT_ROSTER_OCR_CONFIG.tesseractPsm;
  return `roster_ocr_scale_${scale}_psm_${psm}`;
}

// ---------------------------------------------------------------------------
// Score target constant re-export for the experiment platform
// ---------------------------------------------------------------------------

export { ROSTER_OCR_SCORE_TARGET };

/**
 * Known pass keys for roster OCR configs.
 *
 * Add entries here as new variants are designed for experiments.
 */
export const ROSTER_OCR_PASS_KEYS = {
  default: "roster_ocr_scale_2_psm_6",
  highScale: "roster_ocr_scale_3_psm_6",
  sparseText: "roster_ocr_scale_2_psm_3",
} as const;

/**
 * Default config instances for seeding the database via admin UI.
 *
 * Admins may POST to /api/admin/parse-configs with these as templates.
 * The `mode: "roster-ocr"` discriminant lets the API route know that
 * `isValidExtractionConfig` should not be applied; use `isValidRosterOcrConfig`.
 */
export const ROSTER_OCR_DEFAULT_CONFIG: RosterOcrConfig = {
  ...DEFAULT_ROSTER_OCR_CONFIG,
};

export const ROSTER_OCR_HIGH_SCALE_CONFIG: RosterOcrConfig = {
  mode: "roster-ocr",
  preprocessScale: 3.0,
  tesseractPsm: 6,
  minWordConfidence: 40,
};
