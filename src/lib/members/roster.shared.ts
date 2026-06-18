import {
  formatAshedMemberRankValue,
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
    alliance_rank: row.allianceRank ?? undefined,
    rank: rankValue,
  };
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
