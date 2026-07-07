import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  ONBOARDING_REVIEW_INBOX_KIND,
  onboardingReviewHref,
} from "@/lib/member-link/onboarding-review-inbox.shared";

export async function materializeOnboardingReviewInboxItem(input: {
  allianceId: string;
  reviewId: string;
  gameUserName: string;
  requiredPermission: string;
}): Promise<string> {
  const db = getDb();
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, ONBOARDING_REVIEW_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, input.reviewId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind: ONBOARDING_REVIEW_INBOX_KIND,
    title: input.gameUserName,
    body: null,
    scoreTarget: input.gameUserName,
    href: onboardingReviewHref(input.reviewId),
    requiredPermission: input.requiredPermission,
    active: 1,
    resourceId: input.reviewId,
  });

  return itemId;
}

export async function satisfyOnboardingReviewInboxItem(
  reviewId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.kind, ONBOARDING_REVIEW_INBOX_KIND),
        eq(schema.inboxReminderItems.resourceId, reviewId),
      ),
    );
}
