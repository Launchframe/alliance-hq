import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import {
  REGULAR_EVENT_REMINDER_INBOX_KIND,
  REGULAR_EVENT_UPLOAD_REMINDER_INBOX_KIND,
} from "@/lib/regular-events/inbox.shared";

export async function materializeRegularEventReminderInboxItem(input: {
  allianceId: string;
  occurrenceId: string;
  title: string;
  body?: string | null;
  visibleAfter: Date;
}): Promise<string> {
  const db = getDb();

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, REGULAR_EVENT_REMINDER_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, input.occurrenceId),
      ),
    );

  const itemId = nanoid(16);
  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: REGULAR_EVENT_REMINDER_INBOX_KIND,
    title: input.title,
    body: input.body ?? null,
    href: null,
    resourceId: input.occurrenceId,
    visibleAfter: input.visibleAfter,
    requiredPermission: null,
    active: 1,
  });
  return itemId;
}

export async function materializeRegularEventUploadReminderInboxItem(input: {
  allianceId: string;
  occurrenceId: string;
  title: string;
  href: string;
  scoreTarget: string;
  visibleAfter: Date;
}): Promise<string> {
  const db = getDb();

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(
          schema.inboxReminderItems.kind,
          REGULAR_EVENT_UPLOAD_REMINDER_INBOX_KIND,
        ),
        eq(schema.inboxReminderItems.resourceId, input.occurrenceId),
      ),
    );

  const itemId = nanoid(16);
  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: REGULAR_EVENT_UPLOAD_REMINDER_INBOX_KIND,
    title: input.title,
    body: null,
    href: input.href,
    resourceId: input.occurrenceId,
    scoreTarget: input.scoreTarget,
    visibleAfter: input.visibleAfter,
    requiredPermission: "upload:write",
    active: 1,
  });
  return itemId;
}
