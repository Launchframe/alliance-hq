import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  RANK_ELIGIBILITY_POOL_TYPES,
  planCurrentGenerationRankEligibilitySync,
  type RankEligibilityPoolType,
  type RankPoolMemberSnapshot,
} from "@/lib/trains/pool-rank-eligibility.shared";
import {
  getAllianceRanksAsOf,
  resolveMemberPoolAllianceRank,
} from "@/lib/trains/rank-history";

export type RankPoolEligibilitySyncResult = {
  removed: number;
  added: number;
  renamed: number;
};

async function currentGenerationNumber(
  allianceId: string,
  poolType: RankEligibilityPoolType,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      maxGen: sql<number>`coalesce(max(${schema.conductorPoolEntries.generation}), 0)`,
    })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
      ),
    );
  const maxGen = Number(row?.maxGen ?? 0);
  return maxGen > 0 ? maxGen : 1;
}

async function loadMemberSnapshots(
  allianceId: string,
): Promise<RankPoolMemberSnapshot[]> {
  const date = getServerCalendarDate();
  const [members, rankEvents] = await Promise.all([
    listActiveAllianceMembersForPool(allianceId),
    getAllianceRanksAsOf(allianceId, date),
  ]);
  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );
  return members.map((member) => ({
    memberId: member.ashedMemberId,
    memberName: member.currentName,
    rank: resolveMemberPoolAllianceRank(
      member,
      rankByMember.get(member.ashedMemberId),
    ),
  }));
}

/**
 * Align the current generation of one rank pool with live roster ranks.
 * No-ops when that pool has never been seeded.
 */
export async function syncRankEligibilityForCurrentGeneration(
  allianceId: string,
  poolType: RankEligibilityPoolType,
): Promise<RankPoolEligibilitySyncResult> {
  const db = getDb();
  const generation = await currentGenerationNumber(allianceId, poolType);
  const entries = await db
    .select({
      id: schema.conductorPoolEntries.id,
      memberId: schema.conductorPoolEntries.memberId,
      memberName: schema.conductorPoolEntries.memberName,
      allianceRank: schema.conductorPoolEntries.allianceRank,
      selectedAt: schema.conductorPoolEntries.selectedAt,
      sequencePosition: schema.conductorPoolEntries.sequencePosition,
    })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
      ),
    );

  if (entries.length === 0) {
    return { removed: 0, added: 0, renamed: 0 };
  }

  const plan = planCurrentGenerationRankEligibilitySync({
    poolType,
    entries,
    members: await loadMemberSnapshots(allianceId),
  });

  if (plan.unselectedEntryIdsToRemove.length > 0) {
    await db
      .delete(schema.conductorPoolEntries)
      .where(
        inArray(
          schema.conductorPoolEntries.id,
          plan.unselectedEntryIdsToRemove,
        ),
      );
  }

  for (const update of plan.unselectedNameUpdates) {
    await db
      .update(schema.conductorPoolEntries)
      .set({
        memberName: update.memberName,
        allianceRank: update.allianceRank,
      })
      .where(eq(schema.conductorPoolEntries.id, update.id));
  }

  const maxSequence = entries.reduce(
    (max, entry) => Math.max(max, entry.sequencePosition ?? 0),
    0,
  );
  for (let i = 0; i < plan.membersToAdd.length; i += 1) {
    const member = plan.membersToAdd[i]!;
    await db
      .insert(schema.conductorPoolEntries)
      .values({
        id: nanoid(),
        allianceId,
        poolType,
        generation,
        memberId: member.memberId,
        memberName: member.memberName,
        allianceRank: member.rank,
        sequencePosition: maxSequence + i + 1,
      })
      .onConflictDoNothing();
  }

  return {
    removed: plan.unselectedEntryIdsToRemove.length,
    added: plan.membersToAdd.length,
    renamed: plan.unselectedNameUpdates.length,
  };
}

/** Reconcile current R3 and R4+ generations after rank dual-write or roster sync. */
export async function syncRankEligibilityForCurrentGenerations(
  allianceId: string,
): Promise<Record<RankEligibilityPoolType, RankPoolEligibilitySyncResult>> {
  const results = {} as Record<
    RankEligibilityPoolType,
    RankPoolEligibilitySyncResult
  >;
  for (const poolType of RANK_ELIGIBILITY_POOL_TYPES) {
    results[poolType] = await syncRankEligibilityForCurrentGeneration(
      allianceId,
      poolType,
    );
  }
  return results;
}
