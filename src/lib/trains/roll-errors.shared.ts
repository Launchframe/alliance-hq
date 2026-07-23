import type { PoolType } from "@/lib/trains/types";

export type TrainRollErrorCode =
  | "POOL_EMPTY"
  | "POOL_EXHAUSTED"
  | "POOL_UNAVAILABLE"
  | "NO_WHEEL_CANDIDATES"
  | "ASHED_REQUIRED";

export type WheelCandidateKind = "vs" | "vr" | "event" | "donation";

export type TrainRollErrorDetails = {
  code: TrainRollErrorCode;
  poolType?: PoolType;
  candidateKind?: WheelCandidateKind;
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

  if (message === "No VS scores found for the wheel.") {
    return { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" };
  }

  if (message === "No VR standings found for the wheel.") {
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
  return details != null;
}
