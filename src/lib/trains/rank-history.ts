import { and, desc, eq, lte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { AllianceMember } from "@/lib/db/schema";
import { parseAshedMemberAllianceRank } from "@/lib/members/alliance-rank";
import { allianceMemberRowToAshedMember } from "@/lib/members/roster.shared";
import type { PoolType } from "@/lib/trains/types";

/**
 * Rank event sources that dual-write to Ashed via {@link confirmMemberRank}.
 * Only these may use `ashedSyncedAt === null` as “pending Ashed confirm”
 * protection. Scraped mirrors (`lastrank_sync`) never PUT to Ashed — a null
 * stamp on those rows must not permanently override roster / block Ashed sync.
 */
export const ASHED_DUAL_WRITE_RANK_SOURCES = [
  "manual",
  "video_parse",
  "ashed_bootstrap",
] as const;

export type AshedDualWriteRankSource =
  (typeof ASHED_DUAL_WRITE_RANK_SOURCES)[number];

export function isAshedDualWriteRankSource(
  source: string | null | undefined,
): source is AshedDualWriteRankSource {
  return (
    source === "manual" ||
    source === "video_parse" ||
    source === "ashed_bootstrap"
  );
}

type PoolRankEvent = {
  allianceRank: number;
  effectiveDate?: string | null;
  /**
   * When present and `null`, the HQ event never reached Ashed. Prefer the event
   * over roster sync forever in that case — a later Ashed pull still has the
   * pre-confirm rank and must not revive it for pool eligibility.
   * Omit (undefined) for legacy callers that only pass rank + date.
   */
  ashedSyncedAt?: Date | null;
  /**
   * Event provenance. Required for the null-`ashedSyncedAt` privilege when the
   * caller passes a full DB row; omitted events are treated as HQ confirms
   * (legacy unit-test / date-only helpers).
   */
  source?: string | null;
};


type AllianceRankEventRow =
  (typeof schema.memberAllianceRankEvents.$inferSelect);

/**
 * Rank events are append-only. Multiple rows can share the same
 * `effectiveDate` (Ashed sync failure + retry, concurrent officer confirms).
 * As-of reads must keep exactly one event per member: latest effectiveDate,
 * then latest recordedAt, then id.
 */
export function pickLatestAllianceRankEventPerMember(
  events: readonly AllianceRankEventRow[],
): AllianceRankEventRow[] {
  const latestByMember = new Map<string, AllianceRankEventRow>();
  for (const event of events) {
    const previous = latestByMember.get(event.ashedMemberId);
    if (!previous || compareAllianceRankEventsNewestFirst(event, previous) < 0) {
      latestByMember.set(event.ashedMemberId, event);
    }
  }
  return [...latestByMember.values()];
}

/** Negative when `a` is newer than `b` (sort newest-first). */
export function compareAllianceRankEventsNewestFirst(
  a: Pick<AllianceRankEventRow, "effectiveDate" | "recordedAt" | "id">,
  b: Pick<AllianceRankEventRow, "effectiveDate" | "recordedAt" | "id">,
): number {
  if (a.effectiveDate !== b.effectiveDate) {
    return a.effectiveDate < b.effectiveDate ? 1 : -1;
  }
  const aRecorded = a.recordedAt?.getTime() ?? 0;
  const bRecorded = b.recordedAt?.getTime() ?? 0;
  if (aRecorded !== bRecorded) {
    return aRecorded < bRecorded ? 1 : -1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export type ResolvedMemberAllianceRank = {
  rank: number | null;
  title: string | null;
  rankEventId: string | null;
  source: "hq" | "synced" | null;
};

/**
 * Effective rank for train pool eligibility. HQ rank events win when the roster
 * has not synced since the event's effective date; a newer {@link AllianceMember.syncedAt}
 * overrides a stale lower HQ event (promotions that landed in Ashed then synced).
 * An HQ event that never synced to Ashed (`ashedSyncedAt === null`) always wins
 * on mismatch — otherwise the next day's roster pull stamps a newer `syncedAt`
 * with Ashed's pre-confirm rank and silently undoes demotions/promotions.
 * Without both dates, the HQ event wins on mismatch. Falls back to synced
 * roster / Ashed rank when there is no event yet.
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

  // Explicit null (not omitted): HQ confirm wrote the event but Ashed PUT
  // failed. Scraped mirrors (e.g. lastrank_sync) also leave ashedSyncedAt null
  // because they never PUT — do not grant them permanent pool override.
  if (
    rankEvent != null &&
    Object.prototype.hasOwnProperty.call(rankEvent, "ashedSyncedAt") &&
    rankEvent.ashedSyncedAt == null &&
    (rankEvent.source == null || isAshedDualWriteRankSource(rankEvent.source))
  ) {
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
    .orderBy(
      desc(schema.memberAllianceRankEvents.effectiveDate),
      desc(schema.memberAllianceRankEvents.recordedAt),
      desc(schema.memberAllianceRankEvents.id),
    )
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

  // Dedupe same-day ties before rank filters so a stale exactRank row cannot
  // beat a later correction on the same effectiveDate.
  return pickLatestAllianceRankEventPerMember(rows.map((r) => r.event)).filter(
    (event) => {
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
    },
  );
}
