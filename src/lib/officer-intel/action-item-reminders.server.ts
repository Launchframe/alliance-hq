import "server-only";

import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { materializeOfficerActionItemDueInboxItem } from "@/lib/officer-intel/action-item-inbox.server";
import { OFFICER_ACTION_ITEM_DUE_INBOX_KIND } from "@/lib/officer-intel/action-item-inbox.shared";

/** Backfill inbox reminders for due open action items (EUR tick sweep). */
export async function runOfficerActionItemReminderPass(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      id: schema.officerActionItems.id,
      allianceId: schema.officerActionItems.allianceId,
      title: schema.officerActionItems.title,
      dueAt: schema.officerActionItems.dueAt,
    })
    .from(schema.officerActionItems)
    .where(
      and(
        inArray(schema.officerActionItems.status, ["open", "in_progress"]),
        isNotNull(schema.officerActionItems.dueAt),
        lte(schema.officerActionItems.dueAt, now),
      ),
    )
    .limit(200);

  let materialized = 0;
  for (const row of rows) {
    if (!row.dueAt) continue;
    const [existing] = await db
      .select({ id: schema.inboxReminderItems.id })
      .from(schema.inboxReminderItems)
      .where(
        and(
          eq(schema.inboxReminderItems.kind, OFFICER_ACTION_ITEM_DUE_INBOX_KIND),
          eq(schema.inboxReminderItems.resourceId, row.id),
          eq(schema.inboxReminderItems.active, 1),
        ),
      )
      .limit(1);
    if (existing) continue;

    await materializeOfficerActionItemDueInboxItem({
      allianceId: row.allianceId,
      actionItemId: row.id,
      title: row.title,
      dueAt: row.dueAt,
    });
    materialized += 1;
  }

  return materialized;
}
