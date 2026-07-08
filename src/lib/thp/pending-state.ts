import { parseThpBreakdownInput } from "@/lib/thp/breakdown.shared";
import type { ThpPendingState } from "@/lib/thp/types";

/** Parses THP pending JSON loaded from discord_bot_pending. */
export function parseStoredThpPending(value: unknown): ThpPendingState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;

  if (row.kind === "anomaly_confirm" || row.kind === "ocr_confirm") {
    if (
      typeof row.proposedTotal !== "number" ||
      !Number.isFinite(row.proposedTotal) ||
      typeof row.commanderId !== "string" ||
      row.commanderId.trim().length === 0
    ) {
      return null;
    }
    return {
      kind: row.kind,
      proposedTotal: row.proposedTotal,
      proposedBreakdown: parseThpBreakdownInput(row.proposedBreakdown),
      commanderId: row.commanderId.trim(),
    };
  }

  if (row.kind === "pick_character" && Array.isArray(row.linkIds)) {
    return { kind: "pick_character", linkIds: row.linkIds.map(String) };
  }

  return null;
}
