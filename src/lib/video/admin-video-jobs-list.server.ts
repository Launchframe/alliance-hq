import "server-only";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  mergeAdminVideoJobMatchesWithGroupSiblings,
  shouldExpandAdminVideoJobUploadGroups,
} from "@/lib/video/admin-video-jobs-expand.shared";
import { orderAdminVideoJobsForIndex } from "@/lib/video/admin-video-jobs-group.shared";
import { parseAdminVideoJobsStatusFilter } from "@/lib/video/admin-video-jobs-query.shared";

export type AdminVideoJobsListQuery = {
  status: string | null;
  bucket: string | null;
  passKey: string | null;
  rating: string | null;
  ratingReason: string | null;
  scoreTarget: string | null;
  limit: number;
};

/** Parse list/neighbors query params (same defaults as GET /api/admin/video-jobs). */
export function parseAdminVideoJobsListQuery(
  searchParams: URLSearchParams,
): AdminVideoJobsListQuery {
  const rawLimit = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), 500)
    : 100;
  return {
    status: parseAdminVideoJobsStatusFilter(searchParams.get("status")),
    bucket: searchParams.get("bucket"),
    passKey: searchParams.get("passKey"),
    rating: searchParams.get("rating"),
    ratingReason: searchParams.get("ratingReason"),
    scoreTarget: searchParams.get("scoreTarget"),
    limit,
  };
}

function buildAdminVideoJobsListConditions(
  query: AdminVideoJobsListQuery,
): SQL[] {
  return [
    query.status ? eq(schema.videoJobs.status, query.status) : undefined,
    query.bucket ? eq(schema.videoJobs.qualityBucket, query.bucket) : undefined,
    query.passKey ? eq(schema.videoJobs.passKey, query.passKey) : undefined,
    query.rating ? eq(schema.videoJobs.rating, query.rating) : undefined,
    query.ratingReason
      ? eq(schema.videoJobs.ratingReason, query.ratingReason)
      : undefined,
    query.scoreTarget
      ? eq(schema.videoJobs.scoreTarget, query.scoreTarget)
      : undefined,
  ].filter((c): c is SQL => Boolean(c));
}

async function queryMatchedAdminVideoJobs(query: AdminVideoJobsListQuery) {
  const db = getDb();
  const conditions = buildAdminVideoJobsListConditions(query);
  if (conditions.length > 0) {
    return db
      .select()
      .from(schema.videoJobs)
      .where(and(...conditions))
      .orderBy(desc(schema.videoJobs.createdAt))
      .limit(query.limit);
  }
  return db
    .select()
    .from(schema.videoJobs)
    .orderBy(desc(schema.videoJobs.createdAt))
    .limit(query.limit);
}

/**
 * When filters would split a multi-pass upload (e.g. primary review, shadow
 * still processing), pull in the missing siblings so the index can keep them
 * grouped. Skip when filtering by passKey — the user asked for one pass only.
 */
async function expandUploadGroupSiblings<
  T extends { id: string; groupId: string | null },
>(matched: T[], query: AdminVideoJobsListQuery): Promise<T[]> {
  if (!shouldExpandAdminVideoJobUploadGroups(query.passKey, matched.length)) {
    return matched;
  }

  const groupIds = [
    ...new Set(
      matched
        .map((job) => job.groupId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (groupIds.length === 0) return matched;

  const db = getDb();
  const siblings = await db
    .select()
    .from(schema.videoJobs)
    .where(inArray(schema.videoJobs.groupId, groupIds));

  return mergeAdminVideoJobMatchesWithGroupSiblings(matched, siblings as T[]);
}

/** Load video job rows for the admin index (grouped primary+shadow, capped). */
export async function listAdminVideoJobs(query: AdminVideoJobsListQuery) {
  const matched = await queryMatchedAdminVideoJobs(query);
  const withSiblings = await expandUploadGroupSiblings(matched, query);
  return orderAdminVideoJobsForIndex(withSiblings);
}

/** Load only ids for neighbor navigation (same filters/order/limit as the index). */
export async function listAdminVideoJobIds(
  query: AdminVideoJobsListQuery,
): Promise<string[]> {
  const jobs = await listAdminVideoJobs(query);
  return jobs.map((job) => job.id);
}
