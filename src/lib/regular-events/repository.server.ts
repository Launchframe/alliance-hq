import "server-only";

import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { RegularEventKey } from "@/lib/regular-events/catalog.shared";
import type {
  RegularEventScheduleKind,
  RegularEventWeeklySlot,
} from "@/lib/regular-events/types.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export async function getAllianceRegularEventFlags(allianceId: string): Promise<{
  announcementsEnabled: boolean;
  canyonStormActive: boolean;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      announcementsEnabled:
        schema.alliances.regularEventsDiscordAnnouncementsEnabled,
      canyonStormActive: schema.alliances.regularEventsCanyonStormActive,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    announcementsEnabled: row?.announcementsEnabled === 1,
    canyonStormActive: row?.canyonStormActive === 1,
  };
}

export async function setAllianceRegularEventAnnouncementsEnabled(
  allianceId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      regularEventsDiscordAnnouncementsEnabled: enabled ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
}

export async function setAllianceRegularEventsCanyonStormActive(
  allianceId: string,
  active: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      regularEventsCanyonStormActive: active ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
}

export async function listRegularEventScheduleRules(allianceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.regularEventScheduleRules)
    .where(eq(schema.regularEventScheduleRules.allianceId, allianceId));
}

export async function listActiveRegularEventScheduleRules(allianceId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.regularEventScheduleRules)
    .where(
      and(
        eq(schema.regularEventScheduleRules.allianceId, allianceId),
        eq(schema.regularEventScheduleRules.active, 1),
      ),
    );
}

export async function listAlliancesWithRegularEventsAnnouncementsEnabled(): Promise<
  string[]
> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.regularEventsDiscordAnnouncementsEnabled, 1));
  return rows.map((row) => row.id);
}

export async function listAllianceIdsWithActiveRegularEventRules(): Promise<
  string[]
> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ allianceId: schema.regularEventScheduleRules.allianceId })
    .from(schema.regularEventScheduleRules)
    .where(eq(schema.regularEventScheduleRules.active, 1));
  return rows.map((row) => row.allianceId);
}

export async function upsertRegularEventScheduleRule(input: {
  allianceId: string;
  eventKey: RegularEventKey;
  scheduleKind: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  announceLeadMinutes?: number;
  active?: boolean;
}): Promise<typeof schema.regularEventScheduleRules.$inferSelect> {
  const db = getDb();
  const now = new Date();
  const existing = await db
    .select()
    .from(schema.regularEventScheduleRules)
    .where(
      and(
        eq(schema.regularEventScheduleRules.allianceId, input.allianceId),
        eq(schema.regularEventScheduleRules.eventKey, input.eventKey),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(schema.regularEventScheduleRules)
      .set({
        scheduleKind: input.scheduleKind,
        weeklySlots: input.weeklySlots ?? null,
        oneShotDates: input.oneShotDates ?? null,
        biweeklyPhaseMonday: input.biweeklyPhaseMonday ?? null,
        intervalDays: input.intervalDays ?? null,
        anchorTimeSt: input.anchorTimeSt ?? null,
        announceLeadMinutes: input.announceLeadMinutes ?? existing[0].announceLeadMinutes,
        active:
          input.active === undefined ? existing[0].active : input.active ? 1 : 0,
        updatedAt: now,
      })
      .where(eq(schema.regularEventScheduleRules.id, existing[0].id))
      .returning();
    return updated!;
  }

  const [inserted] = await db
    .insert(schema.regularEventScheduleRules)
    .values({
      id: nanoid(16),
      allianceId: input.allianceId,
      eventKey: input.eventKey,
      scheduleKind: input.scheduleKind,
      weeklySlots: input.weeklySlots ?? null,
      oneShotDates: input.oneShotDates ?? null,
      biweeklyPhaseMonday: input.biweeklyPhaseMonday ?? null,
      intervalDays: input.intervalDays ?? null,
      anchorTimeSt: input.anchorTimeSt ?? null,
      announceLeadMinutes: input.announceLeadMinutes ?? 60,
      active: input.active === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return inserted!;
}

export async function updateRegularEventScheduleRuleById(input: {
  allianceId: string;
  ruleId: string;
  scheduleKind?: RegularEventScheduleKind;
  weeklySlots?: RegularEventWeeklySlot[] | null;
  oneShotDates?: string[] | null;
  biweeklyPhaseMonday?: string | null;
  intervalDays?: number | null;
  anchorTimeSt?: string | null;
  announceLeadMinutes?: number;
  active?: boolean;
}): Promise<typeof schema.regularEventScheduleRules.$inferSelect | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.regularEventScheduleRules)
    .where(
      and(
        eq(schema.regularEventScheduleRules.id, input.ruleId),
        eq(schema.regularEventScheduleRules.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  if (!existing) return null;

  const [updated] = await db
    .update(schema.regularEventScheduleRules)
    .set({
      scheduleKind: input.scheduleKind ?? existing.scheduleKind,
      weeklySlots:
        input.weeklySlots === undefined
          ? existing.weeklySlots
          : input.weeklySlots,
      oneShotDates:
        input.oneShotDates === undefined
          ? existing.oneShotDates
          : input.oneShotDates,
      biweeklyPhaseMonday:
        input.biweeklyPhaseMonday === undefined
          ? existing.biweeklyPhaseMonday
          : input.biweeklyPhaseMonday,
      intervalDays:
        input.intervalDays === undefined
          ? existing.intervalDays
          : input.intervalDays,
      anchorTimeSt:
        input.anchorTimeSt === undefined
          ? existing.anchorTimeSt
          : input.anchorTimeSt,
      announceLeadMinutes:
        input.announceLeadMinutes ?? existing.announceLeadMinutes,
      active:
        input.active === undefined ? existing.active : input.active ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.regularEventScheduleRules.id, existing.id))
    .returning();
  return updated ?? null;
}

export async function deleteRegularEventScheduleRule(
  allianceId: string,
  ruleId: string,
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.regularEventScheduleRules)
    .where(
      and(
        eq(schema.regularEventScheduleRules.id, ruleId),
        eq(schema.regularEventScheduleRules.allianceId, allianceId),
      ),
    )
    .returning({ id: schema.regularEventScheduleRules.id });
  return deleted.length > 0;
}

export async function getLastOccurrenceForRule(
  scheduleRuleId: string,
): Promise<Date | null> {
  const db = getDb();
  const [last] = await db
    .select({
      scheduledStartAt: schema.regularEventOccurrences.scheduledStartAt,
    })
    .from(schema.regularEventOccurrences)
    .where(eq(schema.regularEventOccurrences.scheduleRuleId, scheduleRuleId))
    .orderBy(desc(schema.regularEventOccurrences.scheduledStartAt))
    .limit(1);
  return last?.scheduledStartAt ?? null;
}

export async function insertRegularEventOccurrence(input: {
  scheduleRuleId: string;
  allianceId: string;
  eventKey: string;
  occurrenceDate: string;
  scheduledStartAt: Date;
  announceAt: Date;
}): Promise<string | null> {
  const db = getDb();
  const inserted = await db
    .insert(schema.regularEventOccurrences)
    .values({
      id: nanoid(16),
      scheduleRuleId: input.scheduleRuleId,
      allianceId: input.allianceId,
      eventKey: input.eventKey,
      occurrenceDate: input.occurrenceDate,
      scheduledStartAt: input.scheduledStartAt,
      announceAt: input.announceAt,
    })
    .onConflictDoNothing()
    .returning({ id: schema.regularEventOccurrences.id });
  return inserted[0]?.id ?? null;
}

export async function listDueRegularEventOccurrences(now: Date) {
  const db = getDb();
  return db
    .select()
    .from(schema.regularEventOccurrences)
    .where(
      and(
        lte(schema.regularEventOccurrences.announceAt, now),
        isNull(schema.regularEventOccurrences.discordAnnouncedAt),
      ),
    );
}

export async function listDueRegularEventUploadReminders(
  now: Date,
  delayMinutes: number,
) {
  const db = getDb();
  const cutoff = new Date(now.getTime() - delayMinutes * 60 * 1000);
  return db
    .select()
    .from(schema.regularEventOccurrences)
    .where(
      and(
        lte(schema.regularEventOccurrences.scheduledStartAt, cutoff),
        isNull(schema.regularEventOccurrences.uploadRemindedAt),
      ),
    );
}

export async function listDueRegularEventScheduleReminders(now: Date) {
  const db = getDb();
  const todaySt = getServerCalendarDate(now);
  return db
    .select()
    .from(schema.regularEventOccurrences)
    .where(
      and(
        lte(schema.regularEventOccurrences.occurrenceDate, todaySt),
        isNull(schema.regularEventOccurrences.scheduleRemindedAt),
      ),
    );
}

export async function markRegularEventOccurrenceAnnounced(
  occurrenceId: string,
  at: Date,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.regularEventOccurrences)
    .set({ discordAnnouncedAt: at })
    .where(eq(schema.regularEventOccurrences.id, occurrenceId));
}

export async function markRegularEventOccurrenceUploadReminded(
  occurrenceId: string,
  at: Date,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.regularEventOccurrences)
    .set({ uploadRemindedAt: at })
    .where(eq(schema.regularEventOccurrences.id, occurrenceId));
}

export async function markRegularEventOccurrenceScheduleReminded(
  occurrenceId: string,
  at: Date,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.regularEventOccurrences)
    .set({ scheduleRemindedAt: at })
    .where(eq(schema.regularEventOccurrences.id, occurrenceId));
}
