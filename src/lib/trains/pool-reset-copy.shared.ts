export type PoolSummaryForResetCopy = {
  total: number;
  remaining: number;
  exhausted: boolean;
  generation: number;
};

export type PoolResetConfirmBodyKey =
  | "resetConfirmBodyUnseeded"
  | "resetConfirmBodyExhausted"
  | "resetConfirmBodyMidGeneration";

export type PoolResetConfirmActionKey =
  | "resetConfirmActionBuild"
  | "resetConfirmActionStartRotation";

export type PoolResetTriggerLabelKey =
  | "startNewRotation"
  | "buildEligibility";

export function poolResetConfirmBodyKey(
  summary: PoolSummaryForResetCopy,
): PoolResetConfirmBodyKey {
  if (summary.total === 0) {
    return "resetConfirmBodyUnseeded";
  }
  if (summary.exhausted) {
    return "resetConfirmBodyExhausted";
  }
  return "resetConfirmBodyMidGeneration";
}

export function poolResetConfirmActionKey(
  summary: PoolSummaryForResetCopy,
): PoolResetConfirmActionKey {
  if (summary.total === 0) {
    return "resetConfirmActionBuild";
  }
  return "resetConfirmActionStartRotation";
}

export function poolResetTriggerLabelKey(
  summary: PoolSummaryForResetCopy,
): PoolResetTriggerLabelKey {
  if (summary.total === 0) {
    return "buildEligibility";
  }
  return "startNewRotation";
}
