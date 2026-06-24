import { and, desc, eq, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  computeNextIntervalOccurrence,
  computeWeeklyOccurrencesInWindow,
  reminderAt,
  type EurWeeklySlot,
} from "@/lib/eur/schedule-engine";
import {
  refreshVideoJobsPendingItems,
  runEurSatisfactionPass,
} from "@/lib/eur/satisfaction";

const LOOKAHEAD_HOURS = 48;

export async function runEurTick(now = new Date()): Promise<{
  occurrencesCreated: number;
  remindersMaterialized: number;
}> {
  const db = getDb();
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);

  const rules = await db
    .select()
    .from(schema.eurScheduleRules)
    .where(eq(schema.eurScheduleRules.active, 1));

  let occurrencesCreated = 0;

  for (const rule of rules) {
    const slots: EurOccurrenceSlotInput[] = [];

    if (rule.scheduleKind === "weekly" && rule.weeklySlots) {
      const weeklySlots = rule.weeklySlots as EurWeeklySlot[];
      slots.push(
        ...computeWeeklyOccurrencesInWindow(weeklySlots, now, windowEnd).map(
          (row) => ({
            occurrenceDate: row.occurrenceDate,
            scheduledStartAt: row.scheduledStartAt,
          }),
        ),
      );
    } else if (
      rule.scheduleKind === "interval_after_last" &&
      rule.intervalDays &&
      rule.anchorTimeSt
    ) {
      const [last] = await db
        .select({ scheduledStartAt: schema.eurOccurrences.scheduledStartAt })
        .from(schema.eurOccurrences)
        .where(eq(schema.eurOccurrences.scheduleRuleId, rule.id))
        .orderBy(desc(schema.eurOccurrences.scheduledStartAt))
        .limit(1);

      const next = computeNextIntervalOccurrence(
        last?.scheduledStartAt ?? null,
        rule.intervalDays,
        rule.anchorTimeSt,
        now,
        windowEnd,
      );
      if (next) slots.push(next);
    }

    for (const slot of slots) {
      const occurrenceId = nanoid(16);
      const reminderAtTs = reminderAt(
        slot.scheduledStartAt,
        rule.reminderDelayMinutes,
      );

      const inserted = await db
        .insert(schema.eurOccurrences)
        .values({
          id: occurrenceId,
          scheduleRuleId: rule.id,
          allianceId: rule.allianceId,
          scoreTarget: rule.scoreTarget,
          customLabel: rule.customLabel,
          occurrenceDate: slot.occurrenceDate,
          scheduledStartAt: slot.scheduledStartAt,
          reminderAt: reminderAtTs,
          status: "open",
        })
        .onConflictDoNothing()
        .returning({ id: schema.eurOccurrences.id });

      if (inserted.length > 0) occurrencesCreated += 1;
    }
  }

  await runEurSatisfactionPass(now);

  const dueOccurrences = await db
    .select()
    .from(schema.eurOccurrences)
    .where(
      and(
        eq(schema.eurOccurrences.status, "open"),
        lte(schema.eurOccurrences.reminderAt, now),
      ),
    );

  let remindersMaterialized = 0;

  for (const occurrence of dueOccurrences) {
    const title =
      occurrence.customLabel ??
      occurrence.scoreTarget ??
      "Event upload";
    const href = occurrence.scoreTarget
      ? `/tools/video-upload?scoreTarget=${encodeURIComponent(occurrence.scoreTarget)}`
      : "/tools/video-upload";

    const existing = await db
      .select({ id: schema.inboxReminderItems.id })
      .from(schema.inboxReminderItems)
      .where(
        and(
          eq(schema.inboxReminderItems.eurOccurrenceId, occurrence.id),
          eq(schema.inboxReminderItems.active, 1),
        ),
      )
      .limit(1);

    if (existing.length > 0) continue;

    await db.insert(schema.inboxReminderItems).values({
      id: nanoid(16),
      allianceId: occurrence.allianceId,
      kind: "eur_occurrence",
      title,
      body: occurrence.occurrenceDate,
      href,
      scoreTarget: occurrence.scoreTarget,
      eurOccurrenceId: occurrence.id,
      active: 1,
    });
    remindersMaterialized += 1;
  }

  const allianceIds = [
    ...new Set(dueOccurrences.map((row) => row.allianceId)),
  ];
  for (const allianceId of allianceIds) {
    await refreshVideoJobsPendingItems(allianceId);
  }

  return { occurrencesCreated, remindersMaterialized };
}

type EurOccurrenceSlotInput = {
  occurrenceDate: string;
  scheduledStartAt: Date;
};
