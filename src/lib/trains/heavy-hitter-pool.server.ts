import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { startNewPoolGeneration } from "@/lib/trains/pool";
import { getAllianceRanksAsOf } from "@/lib/trains/rank-history";
import { PRICE_IS_RIGHT_MAX_TICKETS } from "@/lib/trains/train-price-is-right-tickets.shared";
import { loadPriceIsRightTicketSettings } from "@/lib/trains/train-economy-threshold.server";
import type { RollCandidate } from "@/lib/trains/types";

export const HEAVY_HITTER_POOL_TYPE = "heavy_hitter" as const;

/** Roster members listed as Price Is Freight max-ticket (heavy-hitter) overrides. */
export async function buildHeavyHitterPoolCandidates(
  allianceId: string,
  date: string = getServerCalendarDate(),
): Promise<RollCandidate[]> {
  const [settings, members, rankEvents] = await Promise.all([
    loadPriceIsRightTicketSettings(allianceId),
    loadActiveAlliancePoolMembers({ allianceId }),
    getAllianceRanksAsOf(allianceId, date),
  ]);

  if (settings.maxTicketMemberIds.length === 0) return [];

  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );
  const memberById = new Map(
    members.map((member) => [member.ashedMemberId, member]),
  );

  const candidates: RollCandidate[] = [];
  for (const memberId of settings.maxTicketMemberIds) {
    const member = memberById.get(memberId);
    if (!member) continue;
    const rankEvent = rankByMember.get(memberId);
    candidates.push({
      memberId,
      memberName: member.currentName,
      allianceRank: rankEvent?.allianceRank ?? member.allianceRank ?? null,
      ticketCount: PRICE_IS_RIGHT_MAX_TICKETS,
    });
  }
  return candidates;
}

async function clearHeavyHitterPool(allianceId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, HEAVY_HITTER_POOL_TYPE),
      ),
    );
}

/**
 * Rebuild the heavy-hitter lottery pool to match current max-ticket overrides.
 * Called whenever Settings → Trains updates the takedown / heavy-hitter list.
 */
export async function syncHeavyHitterPool(allianceId: string): Promise<void> {
  const today = getServerCalendarDate();
  const candidates = await buildHeavyHitterPoolCandidates(allianceId, today);
  if (candidates.length === 0) {
    await clearHeavyHitterPool(allianceId);
    return;
  }
  await startNewPoolGeneration(allianceId, HEAVY_HITTER_POOL_TYPE, candidates);
}
