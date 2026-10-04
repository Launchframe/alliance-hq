import type { PoolType } from "@/lib/trains/types";

export type TrainRollErrorCode =
  | "POOL_EMPTY"
  | "POOL_EXHAUSTED"
  | "POOL_UNAVAILABLE"
  | "POOL_BUSY"
  | "NO_WHEEL_CANDIDATES"
  | "ASHED_REQUIRED";

export type WheelCandidateKind = "vs" | "vr" | "event" | "donation";

export type TrainRollSpinBlockReason = "day_spin_exhausted";

export type TrainRollErrorDetails = {
  code: TrainRollErrorCode;
  poolType?: PoolType;
  candidateKind?: WheelCandidateKind;
  /** VS score calendar day when blocked on missing prior-day scores. */
  scoreDate?: string;
  /** Alliance conductor lead-time days when blocked on missing scores. */
  leadDays?: number;
  /** Finer-grained spin block reason for wheel-blocked copy/CTAs. */
  spinBlockReason?: TrainRollSpinBlockReason;
};

export type TrainRollErrorResponse = {
  error?: string;
  rollError?: TrainRollErrorDetails;
};

export function parseTrainRollError(
  payload: TrainRollErrorResponse,
): TrainRollErrorDetails | null {
  if (payload.rollError?.code) {
    return payload.rollError;
  }

  const message = payload.error?.trim() ?? "";
  if (!message) return null;

  const poolEmpty = message.match(/^No eligible members for (\w+) pool\.$/);
  if (poolEmpty) {
    return {
      code: "POOL_EMPTY",
      poolType: poolEmpty[1] as PoolType,
    };
  }

  if (message.includes("Pool exhausted")) {
    return { code: "POOL_EXHAUSTED" };
  }

  if (message === "No pool entry available.") {
    return { code: "POOL_UNAVAILABLE" };
  }

  if (
    message ===
    "Another officer is spinning this pool right now. Try again in a moment."
  ) {
    return { code: "POOL_BUSY" };
  }

  if (message === "No VS scores found for the wheel.") {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" };
  }

  if (message === "No VR standings found for the wheel.") {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" };
  }

  if (
    message.startsWith("Only ") &&
    message.includes(" active-roster VR standings available for Top ")
  ) {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" };
  }

  if (message === "No event scores found for VIP wheel.") {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "event" };
  }

  if (message === "No donation scores found.") {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "donation" };
  }

  if (
    message.includes("requires an Ashed connection") ||
    message.includes("requires Ashed")
  ) {
    return { code: "ASHED_REQUIRED" };
  }

  return null;
}

export function isWheelBlockedError(
  details: TrainRollErrorDetails | null,
): details is TrainRollErrorDetails {
  if (details == null) return false;
  // Transient lock contention — officer should retry, not open the blocked dialog.
  if (details.code === "POOL_BUSY") return false;
  return true;
}
