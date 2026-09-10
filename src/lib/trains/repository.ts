import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { lockAllianceAvailability, type AvailabilityTransaction } from "@/lib/time-off/availability.server";
import { assertDutyCoverage, CoverageConflictError, findCoverageConflicts, recordAppliedTrainCoverage, trainCoverageDuties } from "@/lib/time-off/coverage.server";
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
  poolClaim?: string;
  automaticDuty?: boolean;
  conductorEligibilityOverridden?: number;
}): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  return getDb().transaction(async (db) => {
  await lockAllianceAvailability(db, input.allianceId);
  const [snapshot] = await db.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` })
    .from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.allianceId, input.allianceId), eq(schema.trainConductorRecords.date, input.date))).for("update");
  const existing = snapshot?.row;
  if (input.automaticDuty && existing) {
    const conflicts = await findCoverageConflicts(db, input.allianceId, trainCoverageDuties(existing, snapshot!.version));
    if (conflicts.length) throw new CoverageConflictError(conflicts);
  }
  await assertDutyCoverage(db, input.allianceId, (["conductor", "vip"] as const).flatMap((dutyRole) => {
    const memberId = dutyRole === "conductor" ? input.conductorMemberId : input.vipMemberId;
    const memberName = dutyRole === "conductor" ? input.conductorMemberName : input.vipMemberName;
    return memberId ? [{ assignmentId: existing?.id ?? `train:${input.date}`, assignmentVersion: snapshot?.version ?? "unassigned", dutyDate: input.date, dutyRole, memberId, memberName: memberName ?? "", lockedAt: existing?.lockedAt?.toISOString() ?? null }] : [];
  }));

  if (existing?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }
  if (input.poolClaim && input.conductorMemberId) {
    const [claimed] = await db.update(schema.conductorPoolEntries).set({ selectedAt: new Date(), selectedForDate: input.date })
      .where(and(eq(schema.conductorPoolEntries.allianceId, input.allianceId), eq(schema.conductorPoolEntries.poolType, input.poolClaim), eq(schema.conductorPoolEntries.memberId, input.conductorMemberId), isNull(schema.conductorPoolEntries.selectedAt),
        sql`${schema.conductorPoolEntries.generation} = (select max(p.generation) from conductor_pool_entries p where p.alliance_id = ${input.allianceId} and p.pool_type = ${input.poolClaim})`)).returning({ id: schema.conductorPoolEntries.id });
    if (!claimed) throw new Error("This member was already selected from the current pool generation.");
  }

  if (existing) {
    const updated = await db
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
        conductorEligibilityOverridden:
          input.conductorEligibilityOverridden ??
          existing.conductorEligibilityOverridden,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.trainConductorRecords.id, existing.id),
          isNull(schema.trainConductorRecords.lockedAt),
        ),
      )
      .returning({ id: schema.trainConductorRecords.id });

    if (updated.length === 0) {
      throw new Error("Conductor is already locked for this day.");
    }

    const [row] = await db
      .select()
      .from(schema.trainConductorRecords)
      .where(eq(schema.trainConductorRecords.id, existing.id))
      .limit(1);
    await recordAppliedTrainCoverage(db, input.allianceId, existing.id);
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
    conductorEligibilityOverridden: input.conductorEligibilityOverridden ?? 0,
  });

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, id))
    .limit(1);
  await recordAppliedTrainCoverage(db, input.allianceId, id);
  return row!;
  });
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
  const memberIdToRelease =
    releasePool && existing.conductorMemberId
      ? existing.conductorMemberId
      : null;

  // CAS: refuse the clear if a concurrent lock won the race.
  const cleared = await db
    .update(schema.trainConductorRecords)
    .set({
      conductorMemberId: null,
      conductorMemberName: null,
      conductorRankEventId: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
      conductorEligibilityOverridden: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, existing.id),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning();

  if (cleared.length === 0) {
    throw new Error("Conductor is already locked for this day.");
  }

  if (memberIdToRelease) {
    await releasePoolSelectionForDate(allianceId, date, memberIdToRelease);
  }

  return cleared[0] ?? null;
}

export async function restampConductorMechanisms(input: {
  allianceId: string;
  date: string;
  seasonKey?: string | null;
  conductorMechanism: string | null;
  vipMechanism: string | null;
  dayConfigId?: string | null;
}): Promise<(typeof schema.trainConductorRecords.$inferSelect) | null> {
  const existing = await getConductorRecord(
    input.allianceId,
    input.date,
    input.seasonKey,
  );
  if (!existing) return null;

  const db = getDb();
  await db
    .update(schema.trainConductorRecords)
    .set({
      conductorMechanism: input.conductorMechanism,
      vipMechanism: input.vipMechanism,
      dayConfigId:
        input.dayConfigId !== undefined
          ? input.dayConfigId
          : existing.dayConfigId,
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
  automaticDuty?: boolean;
}): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  return getDb().transaction(async (db) => {
  await lockAllianceAvailability(db, input.allianceId);
  const [snapshot] = await db.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` })
    .from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.allianceId, input.allianceId), eq(schema.trainConductorRecords.date, input.date))).for("update");
  const existing = snapshot?.row;
  if (!existing?.lockedAt) {
    throw new Error("Lock the conductor before assigning VIP.");
  }
  if (!existing.conductorMemberId) {
    throw new Error("No conductor set for this day.");
  }
  if (input.automaticDuty) {
    const conflicts = await findCoverageConflicts(db, input.allianceId, trainCoverageDuties(existing, snapshot!.version).filter((duty) => duty.dutyRole === "vip"));
    if (conflicts.length) throw new CoverageConflictError(conflicts);
  }
  await assertDutyCoverage(db, input.allianceId, trainCoverageDuties({ ...existing, vipMemberId: input.vipMemberId, vipMemberName: input.vipMemberName }, snapshot!.version).filter((duty) => duty.dutyRole === "vip"));

  const updated = await db
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
    .where(
      and(
        eq(schema.trainConductorRecords.id, existing.id),
        isNotNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new Error("Lock the conductor before assigning VIP.");
  }

  await recordAppliedTrainCoverage(db, input.allianceId, existing.id);
  return updated[0]!;
  });
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

  const vipToRelease = existing.vipMemberId;

  const cleared = await db
    .update(schema.trainConductorRecords)
    .set({
      vipMemberId: null,
      vipMemberName: null,
      vipRankEventId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, existing.id),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning();

  if (cleared.length === 0) {
    throw new Error("Conductor is already locked for this day.");
  }

  if (vipToRelease) {
    await releasePoolSelectionForDate(allianceId, date, vipToRelease);
  }

  return cleared[0] ?? null;
}

/**
 * Atomically swap or open-move two unlocked conductor drafts.
 *
 * Multi-step upsert/clear/pool-move without a transaction can lose a conductor
 * (crash after writing day A but before day B) or double-assign on open-move
 * (crash after writing the target before clearing the source). Concurrent
 * officers can also interleave partial updates.
 *
 * Locks both day rows FOR UPDATE (ordered by date), CAS-checks the expected
 * member ids, then applies record + depleting-pool updates in one transaction.
 */
export async function swapConductorAssignmentsAtomic(input: {
  allianceId: string;
  dateA: string;
  dateB: string;
  seasonKey: string;
  expectedMemberA: { id: string; name: string };
  /** null = open target (no conductor on dateB). */
  expectedMemberB: { id: string; name: string } | null;
  rankEventIdForA: string | null;
  rankEventIdForB: string | null;
}): Promise<{
  recordA: typeof schema.trainConductorRecords.$inferSelect;
  recordB: typeof schema.trainConductorRecords.$inferSelect;
}> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const ensureRow = async (date: string) => {
      const [existing] = await tx
        .select({ id: schema.trainConductorRecords.id })
        .from(schema.trainConductorRecords)
        .where(
          and(
            eq(schema.trainConductorRecords.allianceId, input.allianceId),
            eq(schema.trainConductorRecords.date, date),
          ),
        )
        .limit(1);
      if (existing) return;
      try {
        await tx.insert(schema.trainConductorRecords).values({
          id: nanoid(),
          allianceId: input.allianceId,
          date,
          seasonKey: input.seasonKey,
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        if (code !== "23505") throw error;
      }
    };

    const dates = [input.dateA, input.dateB].sort();
    for (const date of dates) {
      await ensureRow(date);
    }

    const lockedRows = await tx
      .select()
      .from(schema.trainConductorRecords)
      .where(
        and(
          eq(schema.trainConductorRecords.allianceId, input.allianceId),
          or(
            eq(schema.trainConductorRecords.date, input.dateA),
            eq(schema.trainConductorRecords.date, input.dateB),
          ),
        ),
      )
      .orderBy(asc(schema.trainConductorRecords.date))
      .for("update");

    const rowA = lockedRows.find((row) => row.date === input.dateA);
    const rowB = lockedRows.find((row) => row.date === input.dateB);
    if (!rowA || !rowB) {
      throw new Error("Swap failed to load conductor days for update.");
    }

    if (rowA.lockedAt || rowB.lockedAt) {
      throw new Error("Unlock conductor days before swapping.");
    }

    if (rowA.conductorMemberId !== input.expectedMemberA.id) {
      throw new Error(
        "Conductor on the source day changed during swap. Try again.",
      );
    }

    if (input.expectedMemberB) {
      if (rowB.conductorMemberId !== input.expectedMemberB.id) {
        throw new Error(
          "Conductor on the target day changed during swap. Try again.",
        );
      }
    } else if (rowB.conductorMemberId) {
      throw new Error(
        "Target day gained a conductor during swap. Try again.",
      );
    }

    const now = new Date();
    const movePool = async (
      memberId: string,
      fromDate: string,
      toDate: string,
    ) => {
      if (fromDate === toDate) return;
      await tx
        .update(schema.conductorPoolEntries)
        .set({
          selectedForDate: toDate,
          selectedAt: now,
        })
        .where(
          and(
            eq(schema.conductorPoolEntries.allianceId, input.allianceId),
            eq(schema.conductorPoolEntries.selectedForDate, fromDate),
            eq(schema.conductorPoolEntries.memberId, memberId),
          ),
        );
    };

    const releasePool = async (date: string, memberId: string) => {
      await tx
        .update(schema.conductorPoolEntries)
        .set({
          selectedAt: null,
          selectedForDate: null,
        })
        .where(
          and(
            eq(schema.conductorPoolEntries.allianceId, input.allianceId),
            eq(schema.conductorPoolEntries.selectedForDate, date),
            eq(schema.conductorPoolEntries.memberId, memberId),
          ),
        );
    };

    if (input.expectedMemberB) {
      await tx
        .update(schema.trainConductorRecords)
        .set({
          seasonKey: input.seasonKey,
          conductorMemberId: input.expectedMemberB.id,
          conductorMemberName: input.expectedMemberB.name,
          conductorRankEventId: input.rankEventIdForA,
          substituteForMemberId: input.expectedMemberA.id,
          substituteForMemberName: input.expectedMemberA.name,
          updatedAt: now,
        })
        .where(eq(schema.trainConductorRecords.id, rowA.id));

      await tx
        .update(schema.trainConductorRecords)
        .set({
          seasonKey: input.seasonKey,
          conductorMemberId: input.expectedMemberA.id,
          conductorMemberName: input.expectedMemberA.name,
          conductorRankEventId: input.rankEventIdForB,
          substituteForMemberId: input.expectedMemberB.id,
          substituteForMemberName: input.expectedMemberB.name,
          updatedAt: now,
        })
        .where(eq(schema.trainConductorRecords.id, rowB.id));

      await movePool(input.expectedMemberA.id, input.dateA, input.dateB);
      await movePool(input.expectedMemberB.id, input.dateB, input.dateA);
    } else {
      await tx
        .update(schema.trainConductorRecords)
        .set({
          seasonKey: input.seasonKey,
          conductorMemberId: input.expectedMemberA.id,
          conductorMemberName: input.expectedMemberA.name,
          conductorRankEventId: input.rankEventIdForB,
          substituteForMemberId: null,
          substituteForMemberName: null,
          updatedAt: now,
        })
        .where(eq(schema.trainConductorRecords.id, rowB.id));

      await tx
        .update(schema.trainConductorRecords)
        .set({
          conductorMemberId: null,
          conductorMemberName: null,
          conductorRankEventId: null,
          substituteForMemberId: null,
          substituteForMemberName: null,
          updatedAt: now,
        })
        .where(eq(schema.trainConductorRecords.id, rowA.id));

      await movePool(input.expectedMemberA.id, input.dateA, input.dateB);

      if (rowA.vipMemberId) {
        await releasePool(input.dateA, rowA.vipMemberId);
        await tx
          .update(schema.trainConductorRecords)
          .set({
            vipMemberId: null,
            vipMemberName: null,
            vipRankEventId: null,
            updatedAt: now,
          })
          .where(eq(schema.trainConductorRecords.id, rowA.id));
      }
    }

    const [recordA] = await tx
      .select()
      .from(schema.trainConductorRecords)
      .where(eq(schema.trainConductorRecords.id, rowA.id))
      .limit(1);
    const [recordB] = await tx
      .select()
      .from(schema.trainConductorRecords)
      .where(eq(schema.trainConductorRecords.id, rowB.id))
      .limit(1);

    if (!recordA || !recordB?.conductorMemberId || !recordB.conductorMemberName) {
      throw new Error("Swap failed to persist conductor assignment.");
    }

    return { recordA, recordB };
  });
}


export async function lockConductorRecord(
  recordId: string,
  allianceId: string,
  lockedByHqUserId?: string | null,
  transaction?: AvailabilityTransaction,
): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const lock = async (db: AvailabilityTransaction) => {
  await lockAllianceAvailability(db, allianceId);
  const [snapshot] = await db.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` })
    .from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.id, recordId), eq(schema.trainConductorRecords.allianceId, allianceId))).for("update");
  const existing = snapshot?.row;

  if (!existing || existing.allianceId !== allianceId) {
    throw new Error("Conductor record not found.");
  }
  if (existing.lockedAt) {
    throw new Error("Conductor is already locked.");
  }
  if (!existing.conductorMemberId || !existing.conductorMemberName) {
    throw new Error("Select a conductor before locking.");
  }

  await assertDutyCoverage(db, allianceId, trainCoverageDuties(existing, snapshot!.version));
  const lockedAt = new Date();
  const locked = await db
    .update(schema.trainConductorRecords)
    .set({
      lockedAt,
      lockedByHqUserId: lockedByHqUserId ?? null,
      updatedAt: lockedAt,
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, recordId),
        eq(schema.trainConductorRecords.allianceId, allianceId),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning();

  if (locked.length === 0) {
    throw new Error("Conductor is already locked.");
  }

  await spawnEmptyTrain(recordId, db);
  await recordAppliedTrainCoverage(db, allianceId, recordId);
  return locked[0]!;
  };
  return transaction ? lock(transaction) : getDb().transaction(lock);
}

export async function lockConductorRecords(recordIds: string[], allianceId: string, actorId?: string | null) {
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, allianceId);
    const records = [];
    for (const id of [...new Set(recordIds)].sort()) records.push(await lockConductorRecord(id, allianceId, actorId, tx));
    return records;
  });
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

/** CAS claim before Discord post. Returns false if already claimed. */
export async function claimConductorDepartingSoonAnnounced(
  recordId: string,
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.trainConductorRecords)
    .set({ discordDepartingSoonAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.trainConductorRecords.id, recordId),
        eq(schema.trainConductorRecords.allianceId, allianceId),
        isNull(schema.trainConductorRecords.discordDepartingSoonAt),
      ),
    )
    .returning({ id: schema.trainConductorRecords.id });
  return updated.length > 0;
}

export async function clearConductorDepartingSoonAnnounced(
  recordId: string,
  allianceId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.trainConductorRecords)
    .set({ discordDepartingSoonAt: null, updatedAt: now })
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

  // CAS unlock first so a concurrent re-lock cannot leave us having deleted
  // trains while the day is still considered locked.
  const updatedAt = new Date();
  const unlocked = await db
    .update(schema.trainConductorRecords)
    .set({
      lockedAt: null,
      lockedByHqUserId: null,
      discordDepartingSoonAt: null,
      updatedAt,
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, recordId),
        eq(schema.trainConductorRecords.allianceId, allianceId),
        isNotNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning();

  if (unlocked.length === 0) {
    throw new Error("Conductor is not locked.");
  }

  // Keep depleting-pool consumption while the conductor assignment remains.
  // Re-roll / clear / open-target swap release or remaps the slot only when the
  // member is no longer assigned for this date (see roll/pick replace paths).
  await db
    .delete(schema.trains)
    .where(eq(schema.trains.conductorRecordId, recordId));

  return unlocked[0]!;
}

export async function spawnEmptyTrain(
  conductorRecordId: string,
  db: ReturnType<typeof getDb> | AvailabilityTransaction = getDb(),
): Promise<(typeof schema.trains.$inferSelect)> {
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
