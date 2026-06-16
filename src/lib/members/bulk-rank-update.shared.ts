import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import type { AshedMember } from "@/lib/video/member-matcher";

/** Client-safe bulk rank helpers — no DB, session, or rank-sync imports. */

export type BulkMemberRankAction = "set" | "clear";

export function validateBulkMemberRankInput(input: {
  memberIds?: unknown;
  action?: unknown;
  allianceRank?: unknown;
}):
  | { ok: true; memberIds: string[]; action: BulkMemberRankAction; allianceRank?: number }
  | { ok: false; error: string } {
  if (!Array.isArray(input.memberIds) || input.memberIds.length === 0) {
    return { ok: false, error: "Select at least one member." };
  }

  const memberIds = input.memberIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
  if (memberIds.length === 0) {
    return { ok: false, error: "Select at least one member." };
  }

  if (input.action !== "set" && input.action !== "clear") {
    return { ok: false, error: 'action must be "set" or "clear".' };
  }

  if (input.action === "set") {
    const rank = Number(input.allianceRank);
    if (!Number.isFinite(rank) || rank < 1 || rank > 3) {
      return {
        ok: false,
        error: "allianceRank must be 1, 2, or 3 for bulk set.",
      };
    }
    return { ok: true, memberIds, action: "set", allianceRank: rank };
  }

  return { ok: true, memberIds, action: "clear" };
}

/** Patch local roster rows after a successful bulk update. */
export function patchMembersAfterBulkRank(
  members: AshedMember[],
  input: {
    memberIds: string[];
    action: BulkMemberRankAction;
    allianceRank?: number;
  },
): AshedMember[] {
  const idSet = new Set(input.memberIds);
  return members.map((member) => {
    if (!idSet.has(member.id)) return member;

    if (input.action === "clear") {
      return { ...member, rank: "" };
    }

    const rank = input.allianceRank;
    if (rank == null) return member;

    return {
      ...member,
      rank: formatAshedMemberRankValue(rank, null),
    };
  });
}
