import "server-only";

import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  aggregateUploaderScoreTargetRewards,
  VIDEO_JOB_REVIEW_OPEN_STATUSES,
  type UploaderScoreTargetRewardRow,
  type VideoHygieneEventKind,
} from "@/lib/video/video-hygiene-instrumentation.shared";

/** Idempotently stamp the first time an officer opens the review UI. */
export async function markVideoJobReviewOpened(
  jobId: string,
): Promise<{ opened: boolean; reviewOpenedAt: Date | null }> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.videoJobs)
    .set({ reviewOpenedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        inArray(schema.videoJobs.status, [...VIDEO_JOB_REVIEW_OPEN_STATUSES]),
        sql`${schema.videoJobs.reviewOpenedAt} is null`,
      ),
    )
    .returning({ reviewOpenedAt: schema.videoJobs.reviewOpenedAt });

  if (updated[0]) {
    return { opened: true, reviewOpenedAt: updated[0].reviewOpenedAt };
  }

  const [existing] = await db
    .select({ reviewOpenedAt: schema.videoJobs.reviewOpenedAt })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  return {
    opened: false,
    reviewOpenedAt: existing?.reviewOpenedAt ?? null,
  };
}

export async function recordVideoHygieneEvent(params: {
  hqUserId: string;
  scoreTarget: string;
  kind: VideoHygieneEventKind;
  payload?: Record<string, unknown> | null;
  jobId?: string | null;
  allianceId?: string | null;
}): Promise<string> {
  const db = getDb();
  const id = nanoid(16);
  await db.insert(schema.videoHygieneEvents).values({
    id,
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    kind: params.kind,
    payload: params.payload ?? null,
    jobId: params.jobId ?? null,
    allianceId: params.allianceId ?? null,
  });
  return id;
}

export type LoadUploaderScoreTargetRewardsOptions = {
  days?: number;
  hqUserId?: string | null;
  scoreTarget?: string | null;
};

/**
 * Aggregate reward signals by uploader × score target for the learning loop
 * and admin dashboard.
 */
export async function loadUploaderScoreTargetRewards(
  options: LoadUploaderScoreTargetRewardsOptions = {},
): Promise<UploaderScoreTargetRewardRow[]> {
  const db = getDb();
  const days =
    options.days != null && Number.isFinite(options.days) && options.days > 0
      ? Math.min(Math.trunc(options.days), 365)
      : 0;

  const conditions = [
    isNotNull(schema.videoJobs.enqueuedByHqUserId),
    isNotNull(schema.videoJobs.scoreTarget),
    sql`${schema.videoJobs.passRole} is distinct from 'shadow'`,
  ];
  if (days > 0) {
    conditions.push(
      gte(
        schema.videoJobs.createdAt,
        sql`now() - (${days}::int * interval '1 day')`,
      ),
    );
  }
  if (options.hqUserId) {
    conditions.push(
      eq(schema.videoJobs.enqueuedByHqUserId, options.hqUserId),
    );
  }
  if (options.scoreTarget) {
    conditions.push(eq(schema.videoJobs.scoreTarget, options.scoreTarget));
  }

  const rows = await db
    .select({
      hqUserId: schema.videoJobs.enqueuedByHqUserId,
      scoreTarget: schema.videoJobs.scoreTarget,
      rating: schema.videoJobs.rating,
      qualityScore: schema.videoJobs.qualityScore,
      reviewDurationMs: schema.videoJobs.reviewDurationMs,
      reviewRowsEdited: schema.videoJobs.reviewRowsEdited,
      reviewRowsDeleted: schema.videoJobs.reviewRowsDeleted,
      reviewRowsAdded: schema.videoJobs.reviewRowsAdded,
      scrollStyle: schema.videoJobSurveys.scrollStyle,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.videoJobSurveys,
      eq(schema.videoJobSurveys.jobId, schema.videoJobs.id),
    )
    .where(and(...conditions));

  return aggregateUploaderScoreTargetRewards(
    rows
      .filter(
        (row): row is typeof row & { hqUserId: string; scoreTarget: string } =>
          Boolean(row.hqUserId && row.scoreTarget),
      )
      .map((row) => ({
        hqUserId: row.hqUserId,
        scoreTarget: row.scoreTarget,
        rating: row.rating,
        qualityScore: row.qualityScore,
        reviewDurationMs: row.reviewDurationMs,
        reviewRowsEdited: row.reviewRowsEdited,
        reviewRowsDeleted: row.reviewRowsDeleted,
        reviewRowsAdded: row.reviewRowsAdded,
        scrollStyle: row.scrollStyle,
      })),
  );
}
