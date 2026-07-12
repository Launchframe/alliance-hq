import type { KillsPendingState } from "@/lib/kills/types";

/** Parses kills pending JSON loaded from stored pending-state tables. */
export function parseStoredKillsPending(value: unknown): KillsPendingState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;

  if (row.kind === "anomaly_confirm") {
    if (
      typeof row.proposedTotal !== "number" ||
      !Number.isFinite(row.proposedTotal) ||
      typeof row.commanderId !== "string" ||
      row.commanderId.trim().length === 0 ||
      "proposedBreakdown" in row
    ) {
      return null;
    }
    return {
      kind: "anomaly_confirm",
      proposedTotal: row.proposedTotal,
      commanderId: row.commanderId.trim(),
    };
  }

  if (row.kind === "pick_character" && Array.isArray(row.linkIds)) {
    const proposedTotal =
      typeof row.proposedTotal === "number" && Number.isFinite(row.proposedTotal)
        ? row.proposedTotal
        : null;
    return {
      kind: "pick_character",
      linkIds: row.linkIds.map(String),
      proposedTotal,
    };
  }

  return null;
}
