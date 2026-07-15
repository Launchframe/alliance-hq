import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  CAPTURE_REMINDER_DELAY_MS,
  CAPTURE_REMINDER_INBOX_KIND,
} from "@/lib/battle-plan/capture-reminder-inbox.shared";

/**
 * Create (or refresh) an inbox reminder for a stronghold capture event.
 * The item becomes visible 30 minutes after the event's `scheduledAt`.
 */
export async function materializeCaptureReminderInboxItem(input: {
  allianceId: string;
  captureEventId: string;
  scheduledAt: Date;
  title: string;
}): Promise<string> {
  const db = getDb();
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, CAPTURE_REMINDER_INBOX_KIND),
        eq(schema.inboxReminderItems.captureEventId, input.captureEventId),
      ),
    );

  const visibleAfter = new Date(
    input.scheduledAt.getTime() + CAPTURE_REMINDER_DELAY_MS,
  );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: CAPTURE_REMINDER_INBOX_KIND,
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

/** Deactivate the capture reminder when the event is cancelled or deleted. */
export async function deactivateCaptureReminderInboxItem(
  captureEventId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.kind, CAPTURE_REMINDER_INBOX_KIND),
        eq(schema.inboxReminderItems.captureEventId, captureEventId),
      ),
    );
}
