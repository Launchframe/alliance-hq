import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import type { PoolType, RollCandidate } from "@/lib/trains/types";

type PoolGenerationEntry = {
  generation: number;
  selectedForDate: string | null;
};

/** Pure helper — first generation not fully selected before date. */
export function activePoolGenerationForDate(
  generationNumbers: number[],
  entries: PoolGenerationEntry[],
  date: string,
): number {
  if (generationNumbers.length === 0) return 1;

  const sorted = [...generationNumbers].sort((a, b) => a - b);
  for (const gen of sorted) {
    const genEntries = entries.filter((entry) => entry.generation === gen);
    if (genEntries.length === 0) continue;
    const exhaustedBeforeDate = genEntries.every(
      (entry) =>
        entry.selectedForDate != null && entry.selectedForDate < date,
    );
    if (!exhaustedBeforeDate) return gen;
  }

  return sorted[sorted.length - 1]!;
}

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
        ticketCount: c.ticketCount ?? null,
        priorDayVsScore: c.priorDayVsScore ?? null,
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
      ticketCount: c.ticketCount ?? null,
      priorDayVsScore: c.priorDayVsScore ?? null,
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
  return pickUniformPoolEntry(rows);
}

export function pickWeightedPoolEntryFromRows<
  T extends { ticketCount: number | null },
>(rows: T[]): T | null {
  if (rows.length === 0) return null;

  if (rows.some((row) => row.ticketCount == null)) {
    return pickUniformPoolEntry(rows);
  }

  const weightedRows = rows.filter((row) => row.ticketCount != null && row.ticketCount > 0);
  if (weightedRows.length === 0) return null;

  const totalWeight = weightedRows.reduce(
    (sum, row) => sum + (row.ticketCount ?? 0),
    0,
  );
  if (totalWeight <= 0) {
    return pickUniformPoolEntry(rows);
  }

  let roll = Math.random() * totalWeight;
  for (const row of weightedRows) {
    roll -= row.ticketCount ?? 0;
    if (roll <= 0) return row;
  }
  return weightedRows[weightedRows.length - 1] ?? null;
}

function pickUniformPoolEntry<T>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  return rows[Math.floor(Math.random() * rows.length)] ?? null;
}

export async function pickWeightedRandomPoolEntry(
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

  return pickWeightedPoolEntryFromRows(rows);
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

export async function updateCurrentPoolEntryTicketWeights(
  allianceId: string,
  poolType: PoolType,
  weights: Array<{
    memberId: string;
    ticketCount: number;
    priorDayVsScore: number | null;
  }>,
): Promise<void> {
  const db = getDb();
  const generation = await getCurrentPoolGeneration(allianceId, poolType);
  const weightByMember = new Map(
    weights.map((weight) => [weight.memberId, weight]),
  );
  const rows = await db
    .select({
      id: schema.conductorPoolEntries.id,
      memberId: schema.conductorPoolEntries.memberId,
    })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
      ),
    );

  for (const row of rows) {
    const weight = weightByMember.get(row.memberId);
    await db
      .update(schema.conductorPoolEntries)
      .set({
        ticketCount: weight?.ticketCount ?? 0,
        priorDayVsScore: weight?.priorDayVsScore ?? null,
      })
      .where(eq(schema.conductorPoolEntries.id, row.id));
  }
}

export async function resolvePoolGenerationForHistoricalDate(
  allianceId: string,
  poolType: PoolType,
  date: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      generation: schema.conductorPoolEntries.generation,
      selectedForDate: schema.conductorPoolEntries.selectedForDate,
    })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
      ),
    );

  const generationNumbers = [
    ...new Set(rows.map((row) => row.generation)),
  ].sort((a, b) => a - b);

  return activePoolGenerationForDate(generationNumbers, rows, date);
}

export async function markPoolMemberSelectedForDate(
  allianceId: string,
  poolType: PoolType,
  memberId: string,
  date: string,
): Promise<void> {
  const today = getServerCalendarDate();
  const generation =
    date < today
      ? await resolvePoolGenerationForHistoricalDate(allianceId, poolType, date)
      : await getCurrentPoolGeneration(allianceId, poolType);
  const db = getDb();
  const [entry] = await db
    .select({ id: schema.conductorPoolEntries.id })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
        eq(schema.conductorPoolEntries.memberId, memberId),
      ),
    )
    .limit(1);

  if (entry) {
    await markPoolEntrySelected(entry.id, date);
  }
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
