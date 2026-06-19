import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { PoolType, RollCandidate } from "@/lib/trains/types";

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export async function getCurrentPoolGeneration(
  allianceId: string,
  poolType: PoolType,
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

export async function seedPool(
  allianceId: string,
  poolType: PoolType,
  candidates: RollCandidate[],
): Promise<{ generation: number; count: number }> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);
  const shuffled = shuffle(candidates);

  for (let i = 0; i < shuffled.length; i += 1) {
    const c = shuffled[i]!;
    await db
      .insert(schema.conductorPoolEntries)
      .values({
        id: nanoid(),
        allianceId,
        poolType,
        generation,
        memberId: c.memberId,
        memberName: c.memberName,
        allianceRank: c.allianceRank ?? null,
        sequencePosition: i + 1,
      })
      .onConflictDoNothing();
  }

  return { generation, count: shuffled.length };
}

export async function startNewPoolGeneration(
  allianceId: string,
  poolType: PoolType,
  candidates: RollCandidate[],
): Promise<{ generation: number; count: number }> {
  const nextGen = (await getCurrentPoolGeneration(allianceId, poolType)) + 1;
  const db = getDb();
  const shuffled = shuffle(candidates);

  for (let i = 0; i < shuffled.length; i += 1) {
    const c = shuffled[i]!;
    await db.insert(schema.conductorPoolEntries).values({
      id: nanoid(),
      allianceId,
      poolType,
      generation: nextGen,
      memberId: c.memberId,
      memberName: c.memberName,
      allianceRank: c.allianceRank ?? null,
      sequencePosition: i + 1,
    });
  }

  return { generation: nextGen, count: shuffled.length };
}

export async function peekNextPoolEntry(
  allianceId: string,
  poolType: PoolType,
): Promise<(typeof schema.conductorPoolEntries.$inferSelect) | null> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);

  const [next] = await db
    .select()
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
        isNull(schema.conductorPoolEntries.selectedAt),
      ),
    )
    .orderBy(asc(schema.conductorPoolEntries.sequencePosition))
    .limit(1);

  return next ?? null;
}

export async function pickNextPoolEntry(
  allianceId: string,
  poolType: PoolType,
): Promise<(typeof schema.conductorPoolEntries.$inferSelect) | null> {
  return peekNextPoolEntry(allianceId, poolType);
}

export async function pickRandomPoolEntry(
  allianceId: string,
  poolType: PoolType,
): Promise<(typeof schema.conductorPoolEntries.$inferSelect) | null> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);

  const rows = await db
    .select()
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
        isNull(schema.conductorPoolEntries.selectedAt),
      ),
    );

  if (rows.length === 0) return null;
  return rows[Math.floor(Math.random() * rows.length)] ?? null;
}

export async function markPoolEntrySelected(
  entryId: string,
  date: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.conductorPoolEntries)
    .set({
      selectedAt: new Date(),
      selectedForDate: date,
    })
    .where(eq(schema.conductorPoolEntries.id, entryId));
}

/** Platform-admin unlock: return a pool slot consumed by a mistaken lock. */
export async function releasePoolSelectionForDate(
  allianceId: string,
  date: string,
  memberId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.conductorPoolEntries)
    .set({
      selectedAt: null,
      selectedForDate: null,
    })
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.selectedForDate, date),
        eq(schema.conductorPoolEntries.memberId, memberId),
      ),
    );
}

export async function getPoolSummary(
  allianceId: string,
  poolType: PoolType,
): Promise<{
  generation: number;
  total: number;
  remaining: number;
  exhausted: boolean;
  nextInSequence: { memberId: string; memberName: string } | null;
}> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);

  const rows = await db
    .select()
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
      ),
    );

  const remaining = rows.filter((r) => !r.selectedAt).length;
  const nextEntry = await peekNextPoolEntry(allianceId, poolType);
  return {
    generation,
    total: rows.length,
    remaining,
    exhausted: rows.length > 0 && remaining === 0,
    nextInSequence: nextEntry
      ? { memberId: nextEntry.memberId, memberName: nextEntry.memberName }
      : null,
  };
}

export async function listPoolEntries(
  allianceId: string,
  poolType: PoolType,
): Promise<Array<(typeof schema.conductorPoolEntries.$inferSelect)>> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);
  return db
    .select()
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
      ),
    )
    .orderBy(asc(schema.conductorPoolEntries.sequencePosition));
}

export async function poolHasEntries(
  allianceId: string,
  poolType: PoolType,
): Promise<boolean> {
  const summary = await getPoolSummary(allianceId, poolType);
  return summary.total > 0;
}
