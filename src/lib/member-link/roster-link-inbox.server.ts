import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  ROSTER_LINK_INBOX_KIND,
  rosterLinkRequestHref,
} from "@/lib/member-link/roster-link-inbox.shared";

export async function materializeRosterLinkInboxItem(input: {
  allianceId: string;
  requestId: string;
  gameUserName: string;
}): Promise<string> {
  const db = getDb();
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, ROSTER_LINK_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, input.requestId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: ROSTER_LINK_INBOX_KIND,
    /** Fallback for non-localized consumers; inbox UI translates via scoreTarget. */
    title: input.gameUserName,
    body: null,
    scoreTarget: input.gameUserName,
    href: rosterLinkRequestHref(input.requestId),
    requiredPermission: "members:write",
    active: 1,
    resourceId: input.requestId,
  });

  return itemId;
}

export async function satisfyRosterLinkInboxItem(requestId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.kind, ROSTER_LINK_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, requestId),
      ),
    );
}
