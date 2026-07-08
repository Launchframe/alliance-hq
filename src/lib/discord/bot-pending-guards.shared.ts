import type { ThpPendingState } from "@/lib/thp/types";
import type { VrPendingState } from "@/lib/vr/types";

export type ThpConfirmPending =
  | Extract<ThpPendingState, { kind: "anomaly_confirm" }>
  | Extract<ThpPendingState, { kind: "ocr_confirm" }>;

export type VrAnomalyConfirmPending = Extract<
  VrPendingState,
  { kind: "anomaly_confirm" }
>;

/** THP and VR both use `anomaly_confirm`; distinguish by THP-specific fields. */
export function isThpConfirmPending(
  pending: unknown,
): pending is ThpConfirmPending {
  if (!pending || typeof pending !== "object") {
    return false;
  }
  const row = pending as Record<string, unknown>;
  if (row.kind !== "anomaly_confirm" && row.kind !== "ocr_confirm") {
    return false;
  }
  return (
    typeof row.proposedTotal === "number" &&
    Number.isFinite(row.proposedTotal) &&
    typeof row.commanderId === "string" &&
    row.commanderId.trim().length > 0
  );
}

export function isVrAnomalyConfirmPending(
  pending: unknown,
): pending is VrAnomalyConfirmPending {
  if (!pending || typeof pending !== "object") {
    return false;
  }
  const row = pending as Record<string, unknown>;
  if (row.kind !== "anomaly_confirm") {
    return false;
  }
  return (
    typeof row.proposedVr === "number" &&
    Number.isFinite(row.proposedVr) &&
    typeof row.ashedMemberId === "string" &&
    row.ashedMemberId.trim().length > 0
  );
}

export function thpConfirmEventSource(
  pending: ThpConfirmPending,
): "screenshot_ocr" | "discord" {
  if (pending.kind === "ocr_confirm") {
    return "screenshot_ocr";
  }
  return "discord";
}
