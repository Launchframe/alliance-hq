import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { canReviewMemberLinks } from "@/lib/member-link/invite-onboarding-access.server";
import { mergeSelfServiceMemberIntoRosterTarget } from "@/lib/member-link/merge-commander.server";
import {
  materializeOnboardingReviewInboxItem,
  satisfyOnboardingReviewInboxItem,
} from "@/lib/member-link/onboarding-review-inbox.server";
import { loadAllianceMemberOnboardingRow } from "@/lib/member-link/self-service-onboarding.server";
import { getRbacContext } from "@/lib/rbac/context";

export type PendingOnboardingReviewRow = {
  id: string;
  origin: string;
  gameUserName: string;
  gameUidLast4: string;
  gameServerNumber: number | null;
  linkedAshedMemberId: string;
  linkedRosterName: string;
  discordUsername: string | null;
  requesterHqUserId: string | null;
  requesterHandle: string | null;
  requesterEmail: string | null;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
  suggestedMatchedRosterName: string | null;
  inviteId: string | null;
  joinCodeId: string | null;
  createdAt: Date;
};

export async function createOnboardingReviewAfterSelfServiceLink(input: {
  allianceId: string;
  hqUserId: string | null;
  inviteId: string | null;
  joinCodeId: string | null;
  origin: "web" | "discord";
  discordUserId: string | null;
  discordUsername: string | null;
  linkedAshedMemberId: string;
  gameUid: string;
  gameUserName: string;
  gameServerNumber: number | null;
  gameUserLevel: number | null;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
  suggestedMatchedRosterName: string | null;
}): Promise<string> {
  const db = getDb();
  const now = new Date();
  const reviewId = nanoid(16);

  await db.insert(schema.hqMemberOnboardingReviews).values({
    id: reviewId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    inviteId: input.inviteId,
    joinCodeId: input.joinCodeId,
    origin: input.origin,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    linkedAshedMemberId: input.linkedAshedMemberId,
    gameUid: input.gameUid,
    gameUserName: input.gameUserName,
    gameServerNumber: input.gameServerNumber,
    gameUserLevel: input.gameUserLevel,
    status: "pending",
    suggestedTargetAshedMemberId: input.suggestedTargetAshedMemberId,
    suggestionMethod: input.suggestionMethod,
    suggestedMatchedRosterName: input.suggestedMatchedRosterName,
    createdAt: now,
    updatedAt: now,
  });

  await materializeOnboardingReviewInboxItem({
    allianceId: input.allianceId,
    reviewId,
    gameUserName: input.gameUserName,
    requiredPermission: "members:write",
  });

  return reviewId;
}

export async function getOnboardingReviewById(reviewId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberOnboardingReviews)
    .where(eq(schema.hqMemberOnboardingReviews.id, reviewId))
    .limit(1);
  return row ?? null;
}

export async function listPendingOnboardingReviews(
  allianceId: string,
): Promise<PendingOnboardingReviewRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.hqMemberOnboardingReviews)
    .where(
      and(
        eq(schema.hqMemberOnboardingReviews.allianceId, allianceId),
        eq(schema.hqMemberOnboardingReviews.status, "pending"),
      ),
    )
    .orderBy(desc(schema.hqMemberOnboardingReviews.createdAt));

  const linkedMemberIds = [
    ...new Set(rows.map((row) => row.linkedAshedMemberId)),
  ];
  const linkedNames = new Map<string, string>();
  if (linkedMemberIds.length > 0) {
    const members = await db
      .select({
        ashedMemberId: schema.allianceMembers.ashedMemberId,
        currentName: schema.allianceMembers.currentName,
      })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          inArray(schema.allianceMembers.ashedMemberId, linkedMemberIds),
        ),
      );
    for (const member of members) {
      linkedNames.set(member.ashedMemberId, member.currentName);
    }
  }

  const hqUserIds = [
    ...new Set(
      rows.map((row) => row.hqUserId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const hqUsers = new Map<string, { handle: string | null; email: string | null }>();
  if (hqUserIds.length > 0) {
    const users = await db
      .select({
        id: schema.hqUsers.id,
        displayName: schema.hqUsers.displayName,
        email: schema.hqUsers.email,
      })
      .from(schema.hqUsers)
      .where(inArray(schema.hqUsers.id, hqUserIds));
    for (const user of users) {
      hqUsers.set(user.id, {
        handle: user.displayName,
        email: user.email,
      });
    }
  }

  return rows.map((row) => {
    const requester = row.hqUserId ? hqUsers.get(row.hqUserId) : null;
    return {
      id: row.id,
      origin: row.origin,
      gameUserName: row.gameUserName,
      gameUidLast4: row.gameUid.slice(-4),
      gameServerNumber: row.gameServerNumber,
      linkedAshedMemberId: row.linkedAshedMemberId,
      linkedRosterName:
        linkedNames.get(row.linkedAshedMemberId) ?? row.gameUserName,
      discordUsername: row.discordUsername,
      requesterHqUserId: row.hqUserId,
      requesterHandle: requester?.handle ?? row.discordUsername,
      requesterEmail: requester?.email ?? null,
      suggestedTargetAshedMemberId: row.suggestedTargetAshedMemberId,
      suggestionMethod: row.suggestionMethod,
      suggestedMatchedRosterName: row.suggestedMatchedRosterName,
      inviteId: row.inviteId,
      joinCodeId: row.joinCodeId,
      createdAt: row.createdAt,
    };
  });
}

export async function countPendingOnboardingReviews(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [result] = await db
    .select({ total: count() })
    .from(schema.hqMemberOnboardingReviews)
    .where(
      and(
        eq(schema.hqMemberOnboardingReviews.allianceId, allianceId),
        eq(schema.hqMemberOnboardingReviews.status, "pending"),
      ),
    );
  return result?.total ?? 0;
}

async function resolveReviewStatus(input: {
  reviewId: string;
  allianceId: string;
  resolvedByHqUserId: string;
  sessionId: string;
  status: "approved" | "merged" | "dismissed";
  mergedIntoAshedMemberId?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const review = await getOnboardingReviewById(input.reviewId);
  if (!review || review.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (review.status !== "pending") {
    return { ok: false, reason: "already_resolved" };
  }

  const db = getDb();
  const now = new Date();
  await db
    .update(schema.hqMemberOnboardingReviews)
    .set({
      status: input.status,
      resolvedAt: now,
      resolvedByHqUserId: input.resolvedByHqUserId,
      mergedIntoAshedMemberId: input.mergedIntoAshedMemberId ?? null,
      updatedAt: now,
    })
    .where(eq(schema.hqMemberOnboardingReviews.id, input.reviewId));

  await satisfyOnboardingReviewInboxItem(input.reviewId);

  const actionByStatus = {
    approved: "member_link.onboarding_review_approved",
    dismissed: "member_link.onboarding_review_dismissed",
    merged: "member_link.onboarding_review_merged",
  } as const;

  await writeAuditLog({
    sessionId: input.sessionId,
    hqUserId: input.resolvedByHqUserId,
    allianceId: input.allianceId,
    action: actionByStatus[input.status],
    resourceType: "hq_member_onboarding_review",
    resourceId: input.reviewId,
    metadata: {
      reviewId: input.reviewId,
      status: input.status,
      gameUserName: review.gameUserName,
      linkedAshedMemberId: review.linkedAshedMemberId,
      requesterHqUserId: review.hqUserId,
      origin: review.origin,
      ...(input.mergedIntoAshedMemberId
        ? { mergedIntoAshedMemberId: input.mergedIntoAshedMemberId }
        : {}),
    },
  });

  return { ok: true };
}

export async function approveOnboardingReview(input: {
  reviewId: string;
  allianceId: string;
  resolvedByHqUserId: string;
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return resolveReviewStatus({
    ...input,
    status: "approved",
  });
}

export async function dismissOnboardingReview(input: {
  reviewId: string;
  allianceId: string;
  resolvedByHqUserId: string;
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return resolveReviewStatus({
    ...input,
    status: "dismissed",
  });
}

export async function approveAllOnboardingReviews(input: {
  allianceId: string;
  resolvedByHqUserId: string;
  sessionId: string;
}): Promise<number> {
  const pending = await listPendingOnboardingReviews(input.allianceId);
  let count = 0;
  for (const review of pending) {
    const result = await approveOnboardingReview({
      reviewId: review.id,
      allianceId: input.allianceId,
      resolvedByHqUserId: input.resolvedByHqUserId,
      sessionId: input.sessionId,
    });
    if (result.ok) count += 1;
  }
  return count;
}

export async function mergeOnboardingReview(input: {
  reviewId: string;
  allianceId: string;
  targetAshedMemberId: string;
  resolvedByHqUserId: string;
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const review = await getOnboardingReviewById(input.reviewId);
  if (!review || review.allianceId !== input.allianceId) {
    return { ok: false, reason: "not_found" };
  }
  if (review.status !== "pending") {
    return { ok: false, reason: "already_resolved" };
  }

  const merged = await mergeSelfServiceMemberIntoRosterTarget({
    allianceId: input.allianceId,
    sourceAshedMemberId: review.linkedAshedMemberId,
    targetAshedMemberId: input.targetAshedMemberId,
    gameUserName: review.gameUserName,
    gameUid: review.gameUid,
    hqUserId: review.hqUserId,
    discordUserId: review.discordUserId,
  });
  if (!merged.ok) {
    return { ok: false, reason: merged.reason };
  }

  return resolveReviewStatus({
    reviewId: input.reviewId,
    allianceId: input.allianceId,
    resolvedByHqUserId: input.resolvedByHqUserId,
    sessionId: input.sessionId,
    status: "merged",
    mergedIntoAshedMemberId: input.targetAshedMemberId,
  });
}

export async function canSessionReviewOnboardingLinks(input: {
  sessionId: string;
  allianceId: string;
}): Promise<boolean> {
  const alliance = await loadAllianceMemberOnboardingRow(input.allianceId);
  if (!alliance) return false;
  const ctx = await getRbacContext(input.sessionId);
  if (!ctx) return false;
  return canReviewMemberLinks(ctx, alliance);
}
