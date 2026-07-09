import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import type { RollCandidate } from "@/lib/trains/types";

/**
 * Season VR standings from HQ (Discord/web reports). Used for all train wheels,
 * pools, and economy filters — never live Ashed VSScore.
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

  const db = getDb();
  const vrRows = await db
    .select({
      ashedMemberId: schema.memberSeasonVr.ashedMemberId,
      highestBaseVr: schema.memberSeasonVr.highestBaseVr,
    })
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    )
    .orderBy(desc(schema.memberSeasonVr.highestBaseVr));

  const candidates: RollCandidate[] = [];
  for (const row of vrRows) {
    if (candidates.length >= limit) break;
    const memberName = nameById.get(row.ashedMemberId);
    const vr = row.highestBaseVr;
    if (!memberName || vr == null || vr <= 0) continue;
    candidates.push({
      memberId: row.ashedMemberId,
      memberName,
      allianceRank: rankById.get(row.ashedMemberId) ?? null,
    });
  }

  return candidates;
}

/** HQ season VR totals keyed by roster member id (for economy / ticket weighting). */
export async function fetchHqSeasonVsScoresByMember(
  allianceId: string,
): Promise<Map<string, number>> {
  const { seasonKey } = await getEffectiveSeasonForAlliance(allianceId);
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.memberSeasonVr.ashedMemberId,
      highestBaseVr: schema.memberSeasonVr.highestBaseVr,
    })
    .from(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    );

  const scores = new Map<string, number>();
  for (const row of rows) {
    if (row.highestBaseVr > 0) {
      scores.set(row.ashedMemberId, row.highestBaseVr);
    }
  }
  return scores;
}
