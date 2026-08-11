import { and, desc, eq, lte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { AllianceMember } from "@/lib/db/schema";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import type { PoolType } from "@/lib/trains/types";

type PoolRankEvent = {
  allianceRank: number;
  effectiveDate?: string | null;
};

export type ResolvedMemberAllianceRank = {
  rank: number | null;
  title: string | null;
  rankEventId: string | null;
  source: "hq" | "synced" | null;
};

/**
 * Effective rank for train pool eligibility. Prefer the HQ rank event when present
 * (same rule as {@link resolveMemberAllianceRankAsOf}) so confirmed demotions are
 * not overwritten by a stale higher Ashed roster rank after sync. Fall back to the
 * synced roster / Ashed rank raw when there is no event yet.
 */
export function resolveMemberPoolAllianceRank(
  member: AllianceMember,
  rankEvent?: PoolRankEvent | null,
): number | null {
  const syncedRank =
    member.allianceRank ??
    parseAshedMemberAllianceRank(allianceMemberRowToAshedMember(member))
      .rank ??
    null;

  const eventRank = rankEvent?.allianceRank ?? null;
  if (eventRank == null) {
    return syncedRank;
  }
  if (syncedRank == null) {
    return eventRank;
  }
  if (syncedRank === eventRank) {
    return eventRank;
  }

  const eventDate = rankEvent?.effectiveDate?.trim();
  const syncedAt = member.syncedAt;
  if (eventDate && syncedAt) {
    const eventMs = Date.parse(`${eventDate}T23:59:59.999Z`);
    const syncedMs = syncedAt.getTime();
    if (syncedMs > eventMs) {
      return syncedRank;
    }
    return eventRank;
  }

  return eventRank;
}

/** Drop pool rows whose current roster rank no longer matches the pool type. */
export async function memberIdsEligibleForPoolType(
  allianceId: string,
  poolType: PoolType,
  date: string,
  memberIds: readonly string[],
): Promise<Set<string>> {
  if (poolType !== "r3" && poolType !== "r4_plus") {
    return new Set(memberIds);
  }
  if (memberIds.length === 0) {
    return new Set();
  }

  const { loadActiveAlliancePoolMembers } = await import(
    "@/lib/members/game-roster"
  );
  const [members, rankEvents] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId }),
    getAllianceRanksAsOf(allianceId, date),
  ]);
  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );
  const memberById = new Map(
    members.map((member) => [member.ashedMemberId, member]),
  );

  const eligible = new Set<string>();
  for (const memberId of memberIds) {
    const member = memberById.get(memberId);
    if (!member) continue;
    const rank = resolveMemberPoolAllianceRank(
      member,
      rankByMember.get(memberId),
    );
    if (isMemberEligibleForPool(poolType, rank)) {
      eligible.add(memberId);
    }
  }
  return eligible;
}

export function isMemberEligibleForPool(
  poolType: PoolType,
  rank: number | null,
): boolean {
  // Heavy-hitter pool is membership-list based (any rank); see buildHeavyHitterPoolCandidates.
  if (poolType === "heavy_hitter") return true;
  if (rank == null) return false;
  if (poolType === "r3") return rank === 3;
  if (poolType === "r4_plus") return rank >= 4;
  return false;
}

/** Rank as of a calendar date: HQ rank event wins, else locally synced roster rank. */
export async function resolveMemberAllianceRankAsOf(
  allianceId: string,
  ashedMemberId: string,
  date: string,
  syncedRank?: number | null,
  syncedTitle?: string | null,
): Promise<ResolvedMemberAllianceRank> {
  const rankEvent = await getMemberRankAsOf(allianceId, ashedMemberId, date);
  if (rankEvent) {
    return {
      rank: rankEvent.allianceRank,
      title: rankEvent.allianceRankTitle,
      rankEventId: rankEvent.id,
      source: "hq",
    };
  }

  if (syncedRank != null) {
    return {
      rank: syncedRank,
      title: syncedTitle ?? null,
      rankEventId: null,
      source: "synced",
    };
  }

  return { rank: null, title: null, rankEventId: null, source: null };
}

export async function getMemberRankAsOf(
  allianceId: string,
  ashedMemberId: string,
  date: string,
): Promise<(typeof schema.memberAllianceRankEvents.$inferSelect) | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.memberAllianceRankEvents)
    .where(
      and(
        eq(schema.memberAllianceRankEvents.allianceId, allianceId),
        eq(schema.memberAllianceRankEvents.ashedMemberId, ashedMemberId),
        lte(schema.memberAllianceRankEvents.effectiveDate, date),
      ),
    )
    .orderBy(desc(schema.memberAllianceRankEvents.effectiveDate))
    .limit(1);
  return row ?? null;
}

export async function getAllianceRanksAsOf(
  allianceId: string,
  date: string,
  filter?: { minRank?: number; maxRank?: number; exactRank?: number },
): Promise<Array<(typeof schema.memberAllianceRankEvents.$inferSelect)>> {
  const db = getDb();

  const latestPerMember = db
    .select({
      ashedMemberId: schema.memberAllianceRankEvents.ashedMemberId,
      maxEffective: sql<string>`max(${schema.memberAllianceRankEvents.effectiveDate})`.as(
        "max_effective",
      ),
    })
    .from(schema.memberAllianceRankEvents)
    .where(
      and(
        eq(schema.memberAllianceRankEvents.allianceId, allianceId),
        lte(schema.memberAllianceRankEvents.effectiveDate, date),
      ),
    )
    .groupBy(schema.memberAllianceRankEvents.ashedMemberId)
    .as("latest_per_member");

  const rows = await db
    .select({
      event: schema.memberAllianceRankEvents,
    })
    .from(schema.memberAllianceRankEvents)
    .innerJoin(
      latestPerMember,
      and(
        eq(
          schema.memberAllianceRankEvents.ashedMemberId,
          latestPerMember.ashedMemberId,
        ),
        eq(
          schema.memberAllianceRankEvents.effectiveDate,
          latestPerMember.maxEffective,
        ),
      ),
    )
    .where(eq(schema.memberAllianceRankEvents.allianceId, allianceId));

  return rows
    .map((r) => r.event)
    .filter((event) => {
      if (filter?.exactRank != null) {
        return event.allianceRank === filter.exactRank;
      }
      if (filter?.minRank != null && event.allianceRank < filter.minRank) {
        return false;
      }
      if (filter?.maxRank != null && event.allianceRank > filter.maxRank) {
        return false;
      }
      return true;
    });
}
