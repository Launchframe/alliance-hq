import { and, count, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { resolveConductorLastConductedDate } from "@/lib/trains/conductor-stats.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { releasePoolSelectionForDate } from "@/lib/trains/pool";
import type { DayConfigInput, WeekTemplateType } from "@/lib/trains/types";

const TRAIN_CAR_COUNT = 5;
const SLOTS_PER_CAR = 6;

export async function getWeekSchedule(
  allianceId: string,
  weekStart: string,
  seasonKey?: string | null,
): Promise<(typeof schema.trainWeekSchedules.$inferSelect) | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainWeekSchedules)
    .where(
      and(
        eq(schema.trainWeekSchedules.allianceId, allianceId),
        eq(schema.trainWeekSchedules.weekStart, weekStart),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (seasonKey && row.seasonKey && row.seasonKey !== seasonKey) {
    await db
      .update(schema.trainWeekSchedules)
      .set({ seasonKey, updatedAt: new Date() })
      .where(eq(schema.trainWeekSchedules.id, row.id));
    return { ...row, seasonKey };
  }

  return row;
}

/** Deletes day configs in `[weekStart, weekEnd]` and the week schedule row. */
export async function deleteWeekScheduleAndDayConfigs(
  allianceId: string,
  weekStart: string,
  weekEnd: string,
): Promise<{ deletedSchedule: boolean; deletedDayConfigs: number }> {
  const db = getDb();
  const deletedDayConfigs = await db
    .delete(schema.trainDayConfigs)
    .where(
      and(
        eq(schema.trainDayConfigs.allianceId, allianceId),
        gte(schema.trainDayConfigs.date, weekStart),
        lte(schema.trainDayConfigs.date, weekEnd),
      ),
    )
    .returning({ id: schema.trainDayConfigs.id });

  const deletedSchedules = await db
    .delete(schema.trainWeekSchedules)
    .where(
      and(
        eq(schema.trainWeekSchedules.allianceId, allianceId),
        eq(schema.trainWeekSchedules.weekStart, weekStart),
      ),
    )
    .returning({ id: schema.trainWeekSchedules.id });

  return {
    deletedSchedule: deletedSchedules.length > 0,
    deletedDayConfigs: deletedDayConfigs.length,
  };
}

export async function upsertWeekSchedule(input: {
  allianceId: string;
  weekStart: string;
  templateType: WeekTemplateType;
  seasonKey?: string | null;
  notes?: string | null;
  isPivot?: boolean;
}): Promise<(typeof schema.trainWeekSchedules.$inferSelect)> {
  const db = getDb();
  const existing = await getWeekSchedule(
    input.allianceId,
    input.weekStart,
    input.seasonKey,
  );

  if (existing) {
    await db
      .update(schema.trainWeekSchedules)
      .set({
        templateType: input.templateType,
        notes: input.notes ?? null,
        isPivot: input.isPivot ? 1 : 0,
        ...(input.seasonKey ? { seasonKey: input.seasonKey } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.trainWeekSchedules.id, existing.id));
    return { ...existing, templateType: input.templateType };
  }

  const id = nanoid();
  await db.insert(schema.trainWeekSchedules).values({
    id,
    allianceId: input.allianceId,
    weekStart: input.weekStart,
    seasonKey: input.seasonKey ?? null,
    templateType: input.templateType,
    notes: input.notes ?? null,
    isPivot: input.isPivot ? 1 : 0,
  });

  const [row] = await db
    .select()
    .from(schema.trainWeekSchedules)
    .where(eq(schema.trainWeekSchedules.id, id))
    .limit(1);
  return row!;
}

export async function replaceDayConfigs(
  allianceId: string,
  weekScheduleId: string,
  configs: DayConfigInput[],
): Promise<void> {
  const db = getDb();
  for (const config of configs) {
    await db
      .insert(schema.trainDayConfigs)
      .values({
        id: nanoid(),
        weekScheduleId,
        allianceId,
        date: config.date,
        conductorMechanism: config.conductorMechanism,
        conductorConfig: config.conductorConfig ?? null,
        vipMechanism: config.vipMechanism ?? null,
        vipConfig: config.vipConfig ?? null,
      })
      .onConflictDoUpdate({
        target: [
          schema.trainDayConfigs.allianceId,
          schema.trainDayConfigs.date,
        ],
        set: {
          weekScheduleId,
          conductorMechanism: config.conductorMechanism,
          conductorConfig: config.conductorConfig ?? null,
          vipMechanism: config.vipMechanism ?? null,
          vipConfig: config.vipConfig ?? null,
          isOverride: 0,
        },
      });
  }
}

export async function getDayConfig(
  allianceId: string,
  date: string,
): Promise<(typeof schema.trainDayConfigs.$inferSelect) | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainDayConfigs)
    .where(
      and(
        eq(schema.trainDayConfigs.allianceId, allianceId),
        eq(schema.trainDayConfigs.date, date),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listDayConfigsForWeek(
  allianceId: string,
  weekStart: string,
  weekEnd: string,
): Promise<Array<(typeof schema.trainDayConfigs.$inferSelect)>> {
  return listDayConfigsInRange(allianceId, weekStart, weekEnd);
}

export async function listDayConfigsInRange(
  allianceId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<Array<(typeof schema.trainDayConfigs.$inferSelect)>> {
  const db = getDb();
  return db
    .select()
    .from(schema.trainDayConfigs)
    .where(
      and(
        eq(schema.trainDayConfigs.allianceId, allianceId),
        gte(schema.trainDayConfigs.date, rangeStart),
        lte(schema.trainDayConfigs.date, rangeEnd),
      ),
    )
    .orderBy(schema.trainDayConfigs.date);
}

export async function upsertDayConfigOverride(
  allianceId: string,
  weekScheduleId: string,
  config: DayConfigInput,
  isOverride: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.trainDayConfigs)
    .values({
      id: nanoid(),
      weekScheduleId,
      allianceId,
      date: config.date,
      conductorMechanism: config.conductorMechanism,
      conductorConfig: config.conductorConfig ?? null,
      vipMechanism: config.vipMechanism ?? null,
      vipConfig: config.vipConfig ?? null,
      isOverride: isOverride ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [
        schema.trainDayConfigs.allianceId,
        schema.trainDayConfigs.date,
      ],
      set: {
        weekScheduleId,
        conductorMechanism: config.conductorMechanism,
        conductorConfig: config.conductorConfig ?? null,
        vipMechanism: config.vipMechanism ?? null,
        vipConfig: config.vipConfig ?? null,
        isOverride: isOverride ? 1 : 0,
      },
    });
}

export async function getConductorRecord(
  allianceId: string,
  date: string,
  seasonKey?: string | null,
): Promise<(typeof schema.trainConductorRecords.$inferSelect) | null> {
  // One row per alliance+date; seasonKey is metadata updated on upsert, not a lookup filter.
  void seasonKey;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, allianceId),
        eq(schema.trainConductorRecords.date, date),
      ),
    )
    .limit(1);

  if (!row) return null;
  return row;
}

export async function listConductorRecordsForWeek(
  allianceId: string,
  weekStart: string,
  weekEnd: string,
  seasonKey?: string | null,
): Promise<Array<(typeof schema.trainConductorRecords.$inferSelect)>> {
  return listConductorRecordsInRange(
    allianceId,
    weekStart,
    weekEnd,
    seasonKey,
  );
}

export async function listConductorRecordsInRange(
  allianceId: string,
  rangeStart: string,
  rangeEnd: string,
  seasonKey?: string | null,
): Promise<Array<(typeof schema.trainConductorRecords.$inferSelect)>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, allianceId),
        gte(schema.trainConductorRecords.date, rangeStart),
        lte(schema.trainConductorRecords.date, rangeEnd),
      ),
    )
    .orderBy(schema.trainConductorRecords.date);

  if (!seasonKey) return rows;
  return rows.filter((row) => !row.seasonKey || row.seasonKey === seasonKey);
}

export type LockedConductorHistoryQuery = {
  allianceId: string;
  seasonKey?: string | null;
  /** Inclusive upper bound — typically server today. Excludes future-locked rows. */
  maxDate: string;
  dateFrom?: string;
  dateTo?: string;
  /** Matches conductor or VIP on the locked day. */
  memberId?: string;
  allianceRank?: number;
  offset?: number;
  limit?: number;
};

function lockedConductorHistoryWhere(
  input: LockedConductorHistoryQuery,
) {
  const conditions = [
    eq(schema.trainConductorRecords.allianceId, input.allianceId),
    isNotNull(schema.trainConductorRecords.lockedAt),
    lte(schema.trainConductorRecords.date, input.maxDate),
  ];

  if (input.seasonKey) {
    conditions.push(
      or(
        isNull(schema.trainConductorRecords.seasonKey),
        eq(schema.trainConductorRecords.seasonKey, input.seasonKey),
      )!,
    );
  }
  if (input.dateFrom) {
    conditions.push(gte(schema.trainConductorRecords.date, input.dateFrom));
  }
  if (input.dateTo) {
    conditions.push(lte(schema.trainConductorRecords.date, input.dateTo));
  }
  if (input.memberId) {
    conditions.push(
      or(
        eq(schema.trainConductorRecords.conductorMemberId, input.memberId),
        eq(schema.trainConductorRecords.vipMemberId, input.memberId),
      )!,
    );
  }
  if (input.allianceRank != null) {
    conditions.push(
      sql`(
        EXISTS (
          SELECT 1 FROM ${schema.memberAllianceRankEvents} re
          WHERE re.id = ${schema.trainConductorRecords.conductorRankEventId}
            AND re.alliance_rank = ${input.allianceRank}
        )
        OR EXISTS (
          SELECT 1 FROM ${schema.allianceMembers} am
          WHERE am.alliance_id = ${input.allianceId}
            AND am.ashed_member_id = ${schema.trainConductorRecords.conductorMemberId}
            AND am.alliance_rank = ${input.allianceRank}
        )
      )`,
    );
  }

  return and(...conditions);
}

export async function listLockedConductorHistory(
  input: LockedConductorHistoryQuery,
): Promise<{
  rows: Array<(typeof schema.trainConductorRecords.$inferSelect)>;
  total: number;
}> {
  const db = getDb();
  const where = lockedConductorHistoryWhere(input);
  const offset = Math.max(0, input.offset ?? 0);
  const limit = Math.max(1, input.limit ?? 30);

  const [totalRow] = await db
    .select({ total: count() })
    .from(schema.trainConductorRecords)
    .where(where);

  const rows = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(where)
    .orderBy(desc(schema.trainConductorRecords.date))
    .offset(offset)
    .limit(limit);

  return { rows, total: Number(totalRow?.total ?? 0) };
}

export async function upsertConductorDraft(input: {
  allianceId: string;
  date: string;
  seasonKey?: string | null;
  conductorMemberId?: string | null;
  conductorMemberName?: string | null;
  conductorRankEventId?: string | null;
  vipMemberId?: string | null;
  vipMemberName?: string | null;
  vipRankEventId?: string | null;
  conductorMechanism?: string | null;
  vipMechanism?: string | null;
  dayConfigId?: string | null;
  guardianIsVip?: number | null;
  substituteForMemberId?: string | null;
  substituteForMemberName?: string | null;
}): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const db = getDb();
  const existing = await getConductorRecord(
    input.allianceId,
    input.date,
    input.seasonKey,
  );

  if (existing?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  if (existing) {
    await db
      .update(schema.trainConductorRecords)
      .set({
        seasonKey: input.seasonKey ?? existing.seasonKey,
        conductorMemberId: input.conductorMemberId ?? existing.conductorMemberId,
        conductorMemberName:
          input.conductorMemberName ?? existing.conductorMemberName,
        conductorRankEventId:
          input.conductorRankEventId ?? existing.conductorRankEventId,
        vipMemberId: input.vipMemberId ?? existing.vipMemberId,
        vipMemberName: input.vipMemberName ?? existing.vipMemberName,
        vipRankEventId: input.vipRankEventId ?? existing.vipRankEventId,
        conductorMechanism:
          input.conductorMechanism ?? existing.conductorMechanism,
        vipMechanism: input.vipMechanism ?? existing.vipMechanism,
        dayConfigId: input.dayConfigId ?? existing.dayConfigId,
        guardianIsVip:
          input.guardianIsVip != null
            ? input.guardianIsVip
            : existing.guardianIsVip,
        substituteForMemberId:
          input.substituteForMemberId !== undefined
            ? input.substituteForMemberId
            : existing.substituteForMemberId,
        substituteForMemberName:
          input.substituteForMemberName !== undefined
            ? input.substituteForMemberName
            : existing.substituteForMemberName,
        updatedAt: new Date(),
      })
      .where(eq(schema.trainConductorRecords.id, existing.id));

    const [row] = await db
      .select()
      .from(schema.trainConductorRecords)
      .where(eq(schema.trainConductorRecords.id, existing.id))
      .limit(1);
    return row!;
  }

  const id = nanoid();
  await db.insert(schema.trainConductorRecords).values({
    id,
    allianceId: input.allianceId,
    date: input.date,
    seasonKey: input.seasonKey ?? null,
    conductorMemberId: input.conductorMemberId ?? null,
    conductorMemberName: input.conductorMemberName ?? null,
    conductorRankEventId: input.conductorRankEventId ?? null,
    vipMemberId: input.vipMemberId ?? null,
    vipMemberName: input.vipMemberName ?? null,
    vipRankEventId: input.vipRankEventId ?? null,
    conductorMechanism: input.conductorMechanism ?? null,
    vipMechanism: input.vipMechanism ?? null,
    dayConfigId: input.dayConfigId ?? null,
    guardianIsVip: input.guardianIsVip ?? 0,
    substituteForMemberId: input.substituteForMemberId ?? null,
    substituteForMemberName: input.substituteForMemberName ?? null,
  });

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, id))
    .limit(1);
  return row!;
}

export async function clearConductorAssignment(
  allianceId: string,
  date: string,
  seasonKey?: string | null,
  options?: { releasePool?: boolean },
): Promise<(typeof schema.trainConductorRecords.$inferSelect) | null> {
  const db = getDb();
  const existing = await getConductorRecord(allianceId, date, seasonKey);
  if (!existing) return null;
  if (existing.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  const releasePool = options?.releasePool !== false;
  if (releasePool && existing.conductorMemberId) {
    await releasePoolSelectionForDate(
      allianceId,
      date,
      existing.conductorMemberId,
    );
  }

  await db
    .update(schema.trainConductorRecords)
    .set({
      conductorMemberId: null,
      conductorMemberName: null,
      conductorRankEventId: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.trainConductorRecords.id, existing.id));

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, existing.id))
    .limit(1);
  return row ?? null;
}

/**
 * Assign or replace VIP on a locked conductor day. Draft upserts reject
 * locked rows; VIP boarding happens after lock/spawn.
 */
export async function assignVipOnLockedConductor(input: {
  allianceId: string;
  date: string;
  seasonKey?: string | null;
  vipMemberId: string;
  vipMemberName: string;
  vipRankEventId?: string | null;
  vipMechanism?: string | null;
  dayConfigId?: string | null;
  guardianIsVip?: number | null;
}): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const db = getDb();
  const existing = await getConductorRecord(
    input.allianceId,
    input.date,
    input.seasonKey,
  );
  if (!existing?.lockedAt) {
    throw new Error("Lock the conductor before assigning VIP.");
  }
  if (!existing.conductorMemberId) {
    throw new Error("No conductor set for this day.");
  }

  await db
    .update(schema.trainConductorRecords)
    .set({
      vipMemberId: input.vipMemberId,
      vipMemberName: input.vipMemberName,
      vipRankEventId: input.vipRankEventId ?? null,
      vipMechanism: input.vipMechanism ?? existing.vipMechanism,
      dayConfigId: input.dayConfigId ?? existing.dayConfigId,
      guardianIsVip:
        input.guardianIsVip != null
          ? input.guardianIsVip
          : existing.guardianIsVip,
      updatedAt: new Date(),
    })
    .where(eq(schema.trainConductorRecords.id, existing.id));

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, existing.id))
    .limit(1);
  return row!;
}

export async function clearVipAssignment(
  allianceId: string,
  date: string,
  seasonKey?: string | null,
): Promise<(typeof schema.trainConductorRecords.$inferSelect) | null> {
  const db = getDb();
  const existing = await getConductorRecord(allianceId, date, seasonKey);
  if (!existing) return null;
  if (existing.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  if (existing.vipMemberId) {
    await releasePoolSelectionForDate(
      allianceId,
      date,
      existing.vipMemberId,
    );
  }

  await db
    .update(schema.trainConductorRecords)
    .set({
      vipMemberId: null,
      vipMemberName: null,
      vipRankEventId: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.trainConductorRecords.id, existing.id));

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, existing.id))
    .limit(1);
  return row ?? null;
}

export async function lockConductorRecord(
  recordId: string,
  allianceId: string,
): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, recordId))
    .limit(1);

  if (!existing || existing.allianceId !== allianceId) {
    throw new Error("Conductor record not found.");
  }
  if (existing.lockedAt) {
    throw new Error("Conductor is already locked.");
  }
  if (!existing.conductorMemberId || !existing.conductorMemberName) {
    throw new Error("Select a conductor before locking.");
  }

  const lockedAt = new Date();
  await db
    .update(schema.trainConductorRecords)
    .set({ lockedAt, updatedAt: lockedAt })
    .where(eq(schema.trainConductorRecords.id, recordId));

  await spawnEmptyTrain(recordId);

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, recordId))
    .limit(1);
  return row!;
}

export async function markConductorDepartingSoonAnnounced(
  recordId: string,
  allianceId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.trainConductorRecords)
    .set({ discordDepartingSoonAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.trainConductorRecords.id, recordId),
        eq(schema.trainConductorRecords.allianceId, allianceId),
      ),
    );
}

export async function unlockConductorRecord(
  recordId: string,
  allianceId: string,
): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, recordId))
    .limit(1);

  if (!existing || existing.allianceId !== allianceId) {
    throw new Error("Conductor record not found.");
  }
  if (!existing.lockedAt) {
    throw new Error("Conductor is not locked.");
  }

  await db
    .delete(schema.trains)
    .where(eq(schema.trains.conductorRecordId, recordId));

  // Keep depleting-pool consumption while the conductor assignment remains.
  // Re-roll / clear / open-target swap release or remaps the slot only when the
  // member is no longer assigned for this date (see roll/pick replace paths).

  const updatedAt = new Date();
  await db
    .update(schema.trainConductorRecords)
    .set({ lockedAt: null, discordDepartingSoonAt: null, updatedAt })
    .where(eq(schema.trainConductorRecords.id, recordId));

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, recordId))
    .limit(1);
  return row!;
}

export async function spawnEmptyTrain(
  conductorRecordId: string,
): Promise<(typeof schema.trains.$inferSelect)> {
  const db = getDb();
  const trainId = nanoid();
  await db.insert(schema.trains).values({
    id: trainId,
    conductorRecordId,
  });

  for (let car = 1; car <= TRAIN_CAR_COUNT; car += 1) {
    const carId = nanoid();
    await db.insert(schema.trainCars).values({
      id: carId,
      trainId,
      carNumber: car,
    });
    for (let slot = 1; slot <= SLOTS_PER_CAR; slot += 1) {
      await db.insert(schema.trainCarCargoItems).values({
        id: nanoid(),
        trainCarId: carId,
        slotNumber: slot,
        quantity: 0,
      });
    }
  }

  const [row] = await db
    .select()
    .from(schema.trains)
    .where(eq(schema.trains.id, trainId))
    .limit(1);
  return row!;
}

export async function getConductorStats(
  allianceId: string,
  memberId: string,
  options?: { beforeDate?: string | null },
): Promise<{ lastConductedDate: string | null; conductsThisYear: number }> {
  const db = getDb();
  const year = getServerCalendarDate().slice(0, 4);
  const rows = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, allianceId),
        eq(schema.trainConductorRecords.conductorMemberId, memberId),
      ),
    )
    .orderBy(desc(schema.trainConductorRecords.date));

  const locked = rows.filter((r) => r.lockedAt);
  const lastConductedDate = resolveConductorLastConductedDate(
    locked.map((r) => r.date),
    options?.beforeDate,
  );
  const conductsThisYear = locked.filter((r) =>
    r.date.startsWith(year),
  ).length;

  return { lastConductedDate, conductsThisYear };
}

export type MemberLastLockedConductorSummary = {
  memberId: string;
  date: string;
  conductorMechanism: string | null;
};

/** Latest locked conduct per member strictly before `beforeDate`. */
export async function listMemberLastLockedConducts(
  allianceId: string,
  beforeDate: string,
): Promise<MemberLastLockedConductorSummary[]> {
  const db = getDb();
  const result = await db.execute<{
    member_id: string;
    date: string;
    conductor_mechanism: string | null;
  }>(sql`
    SELECT DISTINCT ON (${schema.trainConductorRecords.conductorMemberId})
      ${schema.trainConductorRecords.conductorMemberId} AS member_id,
      ${schema.trainConductorRecords.date} AS date,
      ${schema.trainConductorRecords.conductorMechanism} AS conductor_mechanism
    FROM ${schema.trainConductorRecords}
    WHERE ${schema.trainConductorRecords.allianceId} = ${allianceId}
      AND ${schema.trainConductorRecords.lockedAt} IS NOT NULL
      AND ${schema.trainConductorRecords.conductorMemberId} IS NOT NULL
      AND ${schema.trainConductorRecords.date} < ${beforeDate}
    ORDER BY ${schema.trainConductorRecords.conductorMemberId},
             ${schema.trainConductorRecords.date} DESC
  `);

  return result.map((row) => ({
    memberId: row.member_id,
    date: row.date,
    conductorMechanism: row.conductor_mechanism,
  }));
}

export async function listInventoryItems(): Promise<
  Array<(typeof schema.inventoryItems.$inferSelect)>
> {
  const db = getDb();
  return db.select().from(schema.inventoryItems).orderBy(schema.inventoryItems.name);
}
