import type { VrPendingState } from "@/lib/vr/types";

/** Parses VR pending JSON loaded from discord_bot_pending / hq_vr_pending. */
export function parseStoredVrPending(value: unknown): VrPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "anomaly_confirm") {
    // Reject THP-shaped pending that accidentally shares the kind field.
    if (typeof r.proposedTotal === "number") {
      return null;
    }
    const proposedVr = Number(r.proposedVr);
    const commanderId =
      typeof r.commanderId === "string" ? r.commanderId.trim() : "";
    const ashedMemberId =
      typeof r.ashedMemberId === "string" ? r.ashedMemberId.trim() : "";
    if (!Number.isFinite(proposedVr)) return null;
    if (commanderId.length === 0 && ashedMemberId.length === 0) return null;
    return {
      kind: "anomaly_confirm",
      proposedVr,
      ...(commanderId.length > 0 ? { commanderId } : {}),
      ...(ashedMemberId.length > 0 ? { ashedMemberId } : {}),
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
