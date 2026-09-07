import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  vsComplianceTaskHref,
  type VsComplianceTaskKind,
} from "@/lib/vs-compliance/vs-compliance-inbox.shared";

/**
 * Create (or refresh) the officer inbox task for a VS compliance miss.
 * Idempotent per compliance event — resourceId is the compliance event id,
 * so re-running the weekly evaluation never duplicates an open task.
 */
export async function materializeVsComplianceInboxItem(input: {
  allianceId: string;
  eventId: string;
  kind: VsComplianceTaskKind;
  memberName: string;
}): Promise<string> {
  const db = getDb();

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.resourceId, input.eventId),
      ),
    );

  const itemId = nanoid(16);
  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: input.kind,
    /** Fallback for non-localized consumers; inbox UI translates via scoreTarget. */
    title: input.memberName,
    body: null,
    scoreTarget: input.memberName,
    href: vsComplianceTaskHref(input.eventId),
    requiredPermission: "members:write",
    active: 1,
    resourceId: input.eventId,
  });

  return itemId;
}

/** Deactivate the inbox task when an event is marked complete or waived. */
export async function deactivateVsComplianceInboxItem(
  eventId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(eq(schema.inboxReminderItems.resourceId, eventId));
}
