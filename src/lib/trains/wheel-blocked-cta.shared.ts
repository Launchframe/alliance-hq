import { usesPriceIsFreightConductorRoll } from "@/lib/trains/heavy-hitter-pool.shared";
import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { PoolType, WeekTemplateType } from "@/lib/trains/types";

const RESEEDABLE_POOL_TYPES = new Set<PoolType>([
  "r3",
  "r4_plus",
  "heavy_hitter",
]);

/**
 * Pool types that may show a reseed / new-rotation CTA on the blocked-wheel dialog.
 * Price Is Freight with-replacement paints never reseed (no depleting generation).
 */
export function resolveWheelBlockedReseedPoolType(
  details: TrainRollErrorDetails,
  fallbackPoolType?: PoolType | null,
  options?: {
    paintTemplate?: WeekTemplateType | string | null;
  },
): PoolType | null {
  if (usesPriceIsFreightConductorRoll(options?.paintTemplate)) {
    return null;
  }

  const poolType = details.poolType ?? fallbackPoolType ?? null;
  if (!poolType || !RESEEDABLE_POOL_TYPES.has(poolType)) {
    return null;
  }

  if (details.code === "POOL_EXHAUSTED" || details.code === "POOL_EMPTY") {
    return poolType;
  }

  return null;
}

/** Manual pick is appropriate when scores/minimums block the wheel but the pool still exists. */
export function shouldShowWheelBlockedManualPick(
  details: TrainRollErrorDetails,
): boolean {
  return (
    details.code === "NO_WHEEL_CANDIDATES" ||
    details.code === "ASHED_REQUIRED" ||
    details.code === "POOL_UNAVAILABLE"
  );
}

export type WheelBlockedReseedLabelKey =
  | "wheelBlocked.buildEligibilityAndRespin"
  | "wheelBlocked.startNewRotationAndRespin";

export function wheelBlockedReseedLabelKey(
  details: TrainRollErrorDetails,
): WheelBlockedReseedLabelKey {
  if (details.code === "POOL_EMPTY") {
    return "wheelBlocked.buildEligibilityAndRespin";
  }
  return "wheelBlocked.startNewRotationAndRespin";
}

/** Show lead-time settings CTA when blocked on VS and lead time is configured. */
export function shouldShowWheelBlockedLeadTimeLink(
  details: TrainRollErrorDetails,
): boolean {
  return (
    details.code === "NO_WHEEL_CANDIDATES" &&
    details.candidateKind === "vs" &&
    (details.leadDays ?? 0) > 0
  );
}

export type WheelBlockedVsBodyKey =
  | "wheelBlocked.noVsScores"
  | "wheelBlocked.requiresVsScores"
  | "wheelBlocked.requiresVsScoresWithLeadTime";

/** Body copy key for missing-VS wheel blocks (score day + optional lead time). */
export function wheelBlockedVsBodyKey(
  details: TrainRollErrorDetails,
): WheelBlockedVsBodyKey {
  if (details.scoreDate && (details.leadDays ?? 0) > 0) {
    return "wheelBlocked.requiresVsScoresWithLeadTime";
  }
  if (details.scoreDate) {
    return "wheelBlocked.requiresVsScores";
  }
  return "wheelBlocked.noVsScores";
}
