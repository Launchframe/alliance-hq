import {
  formatAshedMemberRankValue,
  isAshedMemberUnranked,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";
import type { AllianceMember } from "@/lib/db/schema";
import type { AshedMember } from "@/lib/video/member-matcher";

export function readAshedRankRawFromMember(
  member: Record<string, unknown>,
): string | null {
  const raw =
    member.rank ??
    member.alliance_rank ??
    member.allianceRank ??
    member.member_rank;
  if (typeof raw === "number" && raw >= 1 && raw <= 5) {
    return `R${raw}`;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || null;
  }
  return null;
}

export function allianceMemberRowToAshedMember(row: AllianceMember): AshedMember {
  const rankValue =
    row.ashedRankRaw ??
    (row.allianceRank != null
      ? formatAshedMemberRankValue(row.allianceRank, row.allianceRankTitle)
      : undefined);

  return {
    id: row.ashedMemberId,
    current_name: row.currentName,
    previous_names: row.previousNamesJson ?? [],
    alliance_id: row.ashedAllianceId,
    status: row.status,
    commander_sync_status: row.commanderSyncStatus,
    commander_conflict: row.commanderConflictJson ?? undefined,
    alliance_rank: row.allianceRank ?? undefined,
    allianceRank: row.allianceRank ?? undefined,
    allianceRankTitle: row.allianceRankTitle,
    rank: rankValue,
  };
}

/** Rank check for stored roster rows — matches members list unranked filtering. */
export function isStoredAllianceMemberUnranked(
  row: Pick<AllianceMember, "allianceRank" | "allianceRankTitle" | "ashedRankRaw">,
): boolean {
  const rankValue =
    row.ashedRankRaw ??
    (row.allianceRank != null
      ? formatAshedMemberRankValue(row.allianceRank, row.allianceRankTitle)
      : undefined);

  return isAshedMemberUnranked({
    alliance_rank: row.allianceRank ?? undefined,
    allianceRank: row.allianceRank ?? undefined,
    alliance_rank_title: row.allianceRankTitle,
    rank: rankValue,
  });
}

/** Parse rank fields when upserting from a live Ashed Member payload. */
export function normalizedRankFromAshedMember(member: Record<string, unknown>): {
  allianceRank: number | null;
  allianceRankTitle: string | null;
  ashedRankRaw: string | null;
} {
  const parsed = parseAshedMemberAllianceRank(member);
  return {
    allianceRank: parsed.rank,
    allianceRankTitle: parsed.title,
    ashedRankRaw: readAshedRankRawFromMember(member),
  };
}
