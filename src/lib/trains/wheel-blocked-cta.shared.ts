import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { PoolType } from "@/lib/trains/types";

const RESEEDABLE_POOL_TYPES = new Set<PoolType>([
  "r3",
  "r4_plus",
  "heavy_hitter",
]);

/** Pool types that may show a reseed / new-rotation CTA on the blocked-wheel dialog. */
export function resolveWheelBlockedReseedPoolType(
  details: TrainRollErrorDetails,
  fallbackPoolType?: PoolType | null,
): PoolType | null {
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
