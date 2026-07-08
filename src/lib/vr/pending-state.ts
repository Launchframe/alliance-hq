import type { VrPendingState } from "@/lib/vr/types";

/** Parses VR pending JSON loaded from discord_bot_pending. */
export function parseStoredVrPending(value: unknown): VrPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "anomaly_confirm") {
    if (
      typeof r.proposedTotal === "number" ||
      typeof r.commanderId === "string"
    ) {
      return null;
    }
    const proposedVr = Number(r.proposedVr);
    const ashedMemberId =
      typeof r.ashedMemberId === "string" ? r.ashedMemberId.trim() : "";
    if (!Number.isFinite(proposedVr) || ashedMemberId.length === 0) {
      return null;
    }
    return {
      kind: "anomaly_confirm",
      proposedVr,
      ashedMemberId,
    };
  }
  if (r.kind === "pick_character" && Array.isArray(r.linkIds)) {
    return { kind: "pick_character", linkIds: r.linkIds.map(String) };
  }
  if (
    r.kind === "weekly_pass_pick_character" &&
    Array.isArray(r.linkIds) &&
    typeof r.active === "boolean"
  ) {
    return {
      kind: "weekly_pass_pick_character",
      linkIds: r.linkIds.map(String),
      active: r.active,
    };
  }
  return null;
}
