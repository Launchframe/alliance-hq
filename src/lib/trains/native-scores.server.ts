import "server-only";

import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import type { RollCandidate } from "@/lib/trains/types";
import { listAllianceSeasonVrForLeaderboard } from "@/lib/vr/repository";

/**
 * Season VR standings from HQ (Discord/web reports). Used for event Top X
 * VIP seeding and other VR-based train surfaces — not `vs_high_score` /
 * `vs_top_10` (those use prior-day Ashed VSScore).
 */
export async function fetchNativeVrTopScorers(
  allianceId: string,
  limit: number,
): Promise<RollCandidate[]> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  const members = await listActiveAllianceMembersForPool(allianceId);
  const nameById = new Map(
    members.map((member) => [member.ashedMemberId, member.currentName]),
  );
  const rankById = new Map(
    members.map((member) => [member.ashedMemberId, member.allianceRank ?? null]),
  );

  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  const candidates: RollCandidate[] = [];
  for (const row of allianceRows) {
    if (candidates.length >= limit) break;
    const memberName = nameById.get(row.ashedMemberId);
    if (!memberName || row.highestBaseVr <= 0) continue;
    candidates.push({
      memberId: row.ashedMemberId,
      memberName,
      allianceRank: rankById.get(row.ashedMemberId) ?? null,
      priorDayVsScore: row.highestBaseVr,
    });
  }
  return candidates;
}

/** HQ season VR totals keyed by roster member id (for economy / ticket weighting). */
export async function fetchHqSeasonVsScoresByMember(
  allianceId: string,
): Promise<Map<string, number>> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  const allianceRows = await listAllianceSeasonVrForLeaderboard(
    allianceId,
    seasonKey,
  );
  const scores = new Map<string, number>();
  for (const row of allianceRows) {
    if (row.highestBaseVr > 0) {
      scores.set(row.ashedMemberId, row.highestBaseVr);
    }
  }
  return scores;
}
