import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getTranslations } from "next-intl/server";

import { getDb, schema } from "@/lib/db";
import { canReadTeamWorkInbox } from "@/lib/support-teams/work-inbox.server";
import { resolveOnboardingReviewInboxHref } from "@/lib/member-link/onboarding-review-inbox.shared";
import { resolveRosterLinkInboxHref } from "@/lib/member-link/roster-link-inbox.shared";

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
  principalHqUserId?: string;
  allianceId: string;
  permissions: Set<string>;
  includeDismissed?: boolean;
  personalWorkOnly?: boolean;
}): Promise<
  Array<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    href: string | null;
    scoreTarget: string | null;
    resourceId: string | null;
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

  const teamWorkAllowed = items.some((item) => item.kind === "team_work") && await canReadTeamWorkInbox({ allianceId: options.allianceId, hqUserId: options.principalHqUserId ?? options.hqUserId, permissions: options.permissions, personal: options.personalWorkOnly });
  const teamWorkTranslation = teamWorkAllowed ? await getTranslations("teamWork") : null;
  let complianceAllowed = false;
  const complianceTranslation = items.some((item) => item.kind === "vs_compliance") ? await getTranslations("vsCompliance") : null;
  if (complianceTranslation && (options.permissions.has("vs_compliance:read") || options.permissions.has("hq:admin"))) {
    const principalHqUserId = options.principalHqUserId ?? options.hqUserId;
    const [user] = await db.select({ maintainer: schema.hqUsers.isPlatformMaintainer }).from(schema.hqUsers).where(eq(schema.hqUsers.id, principalHqUserId)).limit(1);
    const memberships = await db.select({ roleName: schema.roles.name }).from(schema.allianceMemberships).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId)).where(and(eq(schema.allianceMemberships.allianceId, options.allianceId), eq(schema.allianceMemberships.hqUserId, principalHqUserId), eq(schema.allianceMemberships.status, "active")));
    complianceAllowed = user?.maintainer === 1 || memberships.some((membership) => ["owner", "maintainer", "officer"].includes(membership.roleName));
  }
  const now = new Date();
  return items
    .filter((item) => {
      if (item.kind === "team_work" && !teamWorkAllowed) return false;
      if (item.kind === "vs_compliance" && (!complianceAllowed || teamWorkAllowed && options.permissions.has("vs_compliance:manage"))) return false;
      if (
        item.requiredPermission &&
        !(item.kind === "vs_compliance" && complianceAllowed) &&
        !options.permissions.has(item.requiredPermission)
      ) {
        return false;
      }
      if (!options.includeDismissed && dismissedIds.has(item.id)) {
        return false;
      }
      if (item.visibleAfter && item.visibleAfter > now) {
        return false;
      }
      return true;
    })
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.kind === "team_work" && teamWorkTranslation ? teamWorkTranslation("digest") : item.kind === "vs_compliance" && complianceTranslation ? complianceTranslation("title") : item.title,
      body: item.kind === "vs_compliance" || item.kind === "team_work" ? null : item.body,
      href:
        resolveOnboardingReviewInboxHref({
          kind: item.kind,
          resourceId: item.resourceId,
          href: item.href,
        }) ??
        resolveRosterLinkInboxHref({
          kind: item.kind,
          resourceId: item.resourceId,
          href: item.href,
        }),
      scoreTarget: item.scoreTarget,
      resourceId: item.resourceId,
      createdAt: item.createdAt,
      dismissed: dismissedIds.has(item.id),
    }));
}

export async function countActiveRemindersForUser(options: {
  hqUserId: string;
  principalHqUserId?: string;
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

/** Dismiss only when the item belongs to the caller's alliance. */
export async function dismissReminderItemForAlliance(
  hqUserId: string,
  itemId: string,
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [item] = await db
    .select({ id: schema.inboxReminderItems.id })
    .from(schema.inboxReminderItems)
    .where(
      and(
        eq(schema.inboxReminderItems.id, itemId),
        eq(schema.inboxReminderItems.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!item) return false;

  await dismissReminderItem(hqUserId, itemId);
  return true;
}

export async function dismissAllReminderItems(
  hqUserId: string,
  allianceId: string,
  permissions: Set<string>,
  principalHqUserId?: string,
): Promise<number> {
  const items = await loadReminderInboxForUser({
    hqUserId,
    principalHqUserId,
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
