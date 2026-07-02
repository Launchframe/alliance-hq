import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import type { RollCandidate } from "@/lib/trains/types";

/**
 * Native alliances: season VR standings from HQ (Discord/web reports), not Ashed
 * VSScore. Used for VS-style conductor wheels and event VIP pools when no Ashed
 * session connection is present.
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
