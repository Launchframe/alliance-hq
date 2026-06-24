import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";

const SATISFIED_JOB_STATUSES = ["review", "submitting", "complete"] as const;

export async function runEurSatisfactionPass(now = new Date()): Promise<number> {
  const db = getDb();
  const openOccurrences = await db
    .select()
    .from(schema.eurOccurrences)
    .where(eq(schema.eurOccurrences.status, "open"));

  let satisfied = 0;

  for (const occurrence of openOccurrences) {
    if (!occurrence.scoreTarget) continue;

    const [job] = await db
      .select({ id: schema.videoJobs.id })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.allianceId, occurrence.allianceId),
          eq(schema.videoJobs.scoreTarget, occurrence.scoreTarget),
          inArray(schema.videoJobs.status, [...SATISFIED_JOB_STATUSES]),
          sql`coalesce(${schema.videoJobs.updatedAt}, ${schema.videoJobs.createdAt}) >= ${occurrence.scheduledStartAt}`,
        ),
      )
      .limit(1);

    if (!job) continue;

    await db
      .update(schema.eurOccurrences)
      .set({
        status: "satisfied",
        satisfiedAt: now,
        satisfiedByJobId: job.id,
      })
      .where(eq(schema.eurOccurrences.id, occurrence.id));

    await db
      .update(schema.inboxReminderItems)
      .set({ active: 0 })
      .where(eq(schema.inboxReminderItems.eurOccurrenceId, occurrence.id));

    await refreshVideoJobsPendingItems(occurrence.allianceId);
    satisfied += 1;
  }

  return satisfied;
}

export async function refreshVideoJobsPendingItems(
  allianceId: string,
): Promise<void> {
  const db = getDb();

  const reviewJobs = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.allianceId, allianceId),
        eq(schema.videoJobs.status, "review"),
      ),
    );

  const count = reviewJobs.length;

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, allianceId),
        eq(schema.inboxReminderItems.kind, "video_jobs_pending"),
      ),
    );

  if (count === 0) return;

  await db.insert(schema.inboxReminderItems).values({
    id: nanoid(16),
    allianceId,
    kind: "video_jobs_pending",
    title: `${count} video job${count === 1 ? "" : "s"} to process`,
    body: null,
    href: "/tools/video-upload",
    scoreTarget: null,
    requiredPermission: "upload:write",
    active: 1,
  });
}

export async function loadReminderInboxForUser(options: {
  hqUserId: string;
  allianceId: string;
  permissions: Set<string>;
  includeDismissed?: boolean;
}): Promise<
  Array<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    href: string | null;
    scoreTarget: string | null;
    createdAt: Date;
    dismissed: boolean;
  }>
> {
  const db = getDb();

  const dismissedRows = await db
    .select({ itemId: schema.inboxReminderDismissals.itemId })
    .from(schema.inboxReminderDismissals)
    .where(eq(schema.inboxReminderDismissals.hqUserId, options.hqUserId));

  const dismissedIds = new Set(dismissedRows.map((row) => row.itemId));

  const items = await db
    .select()
    .from(schema.inboxReminderItems)
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, options.allianceId),
        eq(schema.inboxReminderItems.active, 1),
      ),
    )
    .orderBy(sql`${schema.inboxReminderItems.createdAt} DESC`);

  return items
    .filter((item) => {
      if (
        item.requiredPermission &&
        !options.permissions.has(item.requiredPermission)
      ) {
        return false;
      }
      if (!options.includeDismissed && dismissedIds.has(item.id)) {
        return false;
      }
      return true;
    })
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      href: item.href,
      scoreTarget: item.scoreTarget,
      createdAt: item.createdAt,
      dismissed: dismissedIds.has(item.id),
    }));
}

export async function countActiveRemindersForUser(options: {
  hqUserId: string;
  allianceId: string;
  permissions: Set<string>;
}): Promise<number> {
  const items = await loadReminderInboxForUser({
    ...options,
    includeDismissed: false,
  });
  return items.length;
}

export async function dismissReminderItem(
  hqUserId: string,
  itemId: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.inboxReminderDismissals)
    .values({
      id: nanoid(16),
      hqUserId,
      itemId,
    })
    .onConflictDoNothing();
}

export async function dismissAllReminderItems(
  hqUserId: string,
  allianceId: string,
  permissions: Set<string>,
): Promise<number> {
  const items = await loadReminderInboxForUser({
    hqUserId,
    allianceId,
    permissions,
    includeDismissed: false,
  });

  for (const item of items) {
    await dismissReminderItem(hqUserId, item.id);
  }

  return items.length;
}

/** Run satisfaction + pending-job inbox refresh after upload evidence appears. */
export async function notifyEurVideoEvidence(allianceId: string): Promise<void> {
  await runEurSatisfactionPass();
  await refreshVideoJobsPendingItems(allianceId);
}
