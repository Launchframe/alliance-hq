import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  OFFICER_ACTION_ITEM_DUE_INBOX_KIND,
  officerActionItemHref,
} from "@/lib/officer-intel/action-item-inbox.shared";
import { OFFICER_INTEL_READ_PERMISSION } from "@/lib/rbac/constants";

export async function materializeOfficerActionItemDueInboxItem(input: {
  allianceId: string;
  actionItemId: string;
  title: string;
  dueAt: Date;
}): Promise<string> {
  const db = getDb();
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(
          schema.inboxReminderItems.kind,
          OFFICER_ACTION_ITEM_DUE_INBOX_KIND,
        ),
        eq(schema.inboxReminderItems.resourceId, input.actionItemId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: OFFICER_ACTION_ITEM_DUE_INBOX_KIND,
    title: input.title,
    body: null,
    href: officerActionItemHref(input.actionItemId),
    visibleAfter: input.dueAt,
    requiredPermission: OFFICER_INTEL_READ_PERMISSION,
    active: 1,
    resourceId: input.actionItemId,
  });

  return itemId;
}

export async function deactivateOfficerActionItemDueInboxItem(
  actionItemId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(
          schema.inboxReminderItems.kind,
          OFFICER_ACTION_ITEM_DUE_INBOX_KIND,
        ),
        eq(schema.inboxReminderItems.resourceId, actionItemId),
      ),
    );
}
