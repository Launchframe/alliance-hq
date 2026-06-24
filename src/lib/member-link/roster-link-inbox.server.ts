import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

const MEMBER_LINK_REQUEST_KIND = "member_link_request";

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
        eq(schema.inboxReminderItems.kind, MEMBER_LINK_REQUEST_KIND),
        eq(schema.inboxReminderItems.resourceId, input.requestId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: MEMBER_LINK_REQUEST_KIND,
    title: `Roster link: ${input.gameUserName}`,
    body: "A player needs owner approval to join the roster.",
    href: "/inbox",
    requiredPermission: "inbox:read",
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
        eq(schema.inboxReminderItems.kind, MEMBER_LINK_REQUEST_KIND),
        eq(schema.inboxReminderItems.resourceId, requestId),
      ),
    );
}
