import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
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
  const db = getDb();
  return db
    .select()
    .from(schema.trainDayConfigs)
    .where(
      and(
        eq(schema.trainDayConfigs.allianceId, allianceId),
        // date strings sort lexicographically for YYYY-MM-DD
      ),
    )
    .then((rows) =>
      rows.filter((r) => r.date >= weekStart && r.date <= weekEnd),
    );
}

export async function getConductorRecord(
  allianceId: string,
  date: string,
  seasonKey?: string | null,
): Promise<(typeof schema.trainConductorRecords.$inferSelect) | null> {
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
  if (seasonKey && row.seasonKey && row.seasonKey !== seasonKey) {
    return null;
  }
  return row;
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
  });

  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, id))
    .limit(1);
  return row!;
}

export async function lockConductorRecord(
  recordId: string,
): Promise<(typeof schema.trainConductorRecords.$inferSelect)> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(eq(schema.trainConductorRecords.id, recordId))
    .limit(1);

  if (!existing) {
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
): Promise<{ lastConductedDate: string | null; conductsThisYear: number }> {
  const db = getDb();
  const year = new Date().getFullYear().toString();
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
  const lastConductedDate = locked[0]?.date ?? null;
  const conductsThisYear = locked.filter((r) =>
    r.date.startsWith(year),
  ).length;

  return { lastConductedDate, conductsThisYear };
}

export async function listInventoryItems(): Promise<
  Array<(typeof schema.inventoryItems.$inferSelect)>
> {
  const db = getDb();
  return db.select().from(schema.inventoryItems).orderBy(schema.inventoryItems.name);
}
