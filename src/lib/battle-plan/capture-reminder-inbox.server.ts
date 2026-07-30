import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  BATTLE_PLAN_REMINDER_INBOX_KINDS,
  CAPTURE_REMINDER_DELAY_MS,
  CAPTURE_REMINDER_INBOX_KIND,
  DEPOSIT_WINDOW_REMINDER_INBOX_KIND,
  type BattlePlanReminderInboxKind,
} from "@/lib/battle-plan/capture-reminder-inbox.shared";
import { getDb, schema } from "@/lib/db";

/**
 * Create (or refresh) an inbox reminder for a battle-plan capture event.
 * The item becomes visible 30 minutes after the event's `scheduledAt`.
 */
export async function materializeBattlePlanReminderInboxItem(input: {
  allianceId: string;
  captureEventId: string;
  scheduledAt: Date;
  title: string;
  kind: BattlePlanReminderInboxKind;
}): Promise<string> {
  const db = getDb();
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, input.kind),
        eq(schema.inboxReminderItems.captureEventId, input.captureEventId),
      ),
    );

  const visibleAfter = new Date(
    input.scheduledAt.getTime() + CAPTURE_REMINDER_DELAY_MS,
  );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: input.kind,
    title: input.title,
    body: null,
    href: null,
    captureEventId: input.captureEventId,
    visibleAfter,
    requiredPermission: "battle_plan:write",
    active: 1,
    resourceId: input.captureEventId,
  });

  return itemId;
}

/** @deprecated Use materializeBattlePlanReminderInboxItem */
export async function materializeCaptureReminderInboxItem(input: {
  allianceId: string;
  captureEventId: string;
  scheduledAt: Date;
  title: string;
}): Promise<string> {
  return materializeBattlePlanReminderInboxItem({
    ...input,
    kind: CAPTURE_REMINDER_INBOX_KIND,
  });
}

export async function materializeDepositWindowReminderInboxItem(input: {
  allianceId: string;
  captureEventId: string;
  scheduledAt: Date;
  title: string;
}): Promise<string> {
  return materializeBattlePlanReminderInboxItem({
    ...input,
    kind: DEPOSIT_WINDOW_REMINDER_INBOX_KIND,
  });
}

/** Deactivate all battle-plan reminders tied to an event. */
export async function deactivateBattlePlanReminderInboxItems(
  captureEventId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        inArray(schema.inboxReminderItems.kind, [...BATTLE_PLAN_REMINDER_INBOX_KINDS]),
        eq(schema.inboxReminderItems.captureEventId, captureEventId),
      ),
    );
}

/** @deprecated Use deactivateBattlePlanReminderInboxItems */
export async function deactivateCaptureReminderInboxItem(
  captureEventId: string,
): Promise<void> {
  return deactivateBattlePlanReminderInboxItems(captureEventId);
}
