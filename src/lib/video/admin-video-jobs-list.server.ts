import "server-only";

import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  mergeAdminVideoJobMatchesWithGroupSiblings,
  shouldExpandAdminVideoJobUploadGroups,
} from "@/lib/video/admin-video-jobs-expand.shared";
import {
  orderAdminVideoJobsForIndex,
  type AdminVideoJobGroupFields,
} from "@/lib/video/admin-video-jobs-group.shared";
import {
  listStoredAllianceIdsForHqAlliance,
  videoJobStoredAllianceIdIn,
} from "@/lib/video/video-job-alliance.server";
import { parseAdminVideoJobsStatusFilter } from "@/lib/video/admin-video-jobs-query.shared";

export type AdminVideoJobsListQuery = {
  status: string | null;
  bucket: string | null;
  passKey: string | null;
  rating: string | null;
  /** API-only (list UI does not expose); kept for backward-compatible deep links. */
  ratingReason: string | null;
  /** API-only (list UI does not expose); kept for backward-compatible deep links. */
  scoreTarget: string | null;
  limit: number;
  /** When set, restrict to one alliance (tools processor console). */
  allianceId?: string | null;
};

/** Columns needed to expand groups and order the admin index / neighbor window. */
const ADMIN_VIDEO_JOB_INDEX_COLUMNS = {
  id: schema.videoJobs.id,
  groupId: schema.videoJobs.groupId,
  passRole: schema.videoJobs.passRole,
  passIndex: schema.videoJobs.passIndex,
  createdAt: schema.videoJobs.createdAt,
} as const;

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
  storedAllianceIds: readonly string[] | null,
): SQL[] {
  return [
    storedAllianceIds?.length
      ? videoJobStoredAllianceIdIn(storedAllianceIds)
      : undefined,
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

async function resolveStoredAllianceIdsForListQuery(
  query: AdminVideoJobsListQuery,
): Promise<readonly string[] | null> {
  const hqAllianceId = query.allianceId?.trim();
  if (!hqAllianceId) return null;
  return listStoredAllianceIdsForHqAlliance(hqAllianceId);
}

async function queryMatchedAdminVideoJobs(query: AdminVideoJobsListQuery) {
  const db = getDb();
  const storedAllianceIds = await resolveStoredAllianceIdsForListQuery(query);
  const conditions = buildAdminVideoJobsListConditions(
    query,
    storedAllianceIds,
  );
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

async function queryMatchedAdminVideoJobIndexRows(
  query: AdminVideoJobsListQuery,
): Promise<AdminVideoJobGroupFields[]> {
  const db = getDb();
  const storedAllianceIds = await resolveStoredAllianceIdsForListQuery(query);
  const conditions = buildAdminVideoJobsListConditions(
    query,
    storedAllianceIds,
  );
  if (conditions.length > 0) {
    return db
      .select(ADMIN_VIDEO_JOB_INDEX_COLUMNS)
      .from(schema.videoJobs)
      .where(and(...conditions))
      .orderBy(desc(schema.videoJobs.createdAt))
      .limit(query.limit);
  }
  return db
    .select(ADMIN_VIDEO_JOB_INDEX_COLUMNS)
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
>(
  matched: T[],
  query: AdminVideoJobsListQuery,
  options?: { indexColumnsOnly?: boolean },
): Promise<T[]> {
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
  const siblings = options?.indexColumnsOnly
    ? await db
        .select(ADMIN_VIDEO_JOB_INDEX_COLUMNS)
        .from(schema.videoJobs)
        .where(inArray(schema.videoJobs.groupId, groupIds))
    : await db
        .select()
        .from(schema.videoJobs)
        .where(inArray(schema.videoJobs.groupId, groupIds));

  return mergeAdminVideoJobMatchesWithGroupSiblings(matched, siblings as T[]);
}

/**
 * Load video job rows for the admin index (grouped primary+shadow).
 *
 * `limit` applies to the filtered match query only. Sibling expansion may grow
 * the returned list (and neighbor “N of M”) above that limit so multi-pass
 * uploads stay intact — do not “fix” M > limit as a pagination bug.
 */
export async function listAdminVideoJobs(query: AdminVideoJobsListQuery) {
  const matched = await queryMatchedAdminVideoJobs(query);
  const withSiblings = await expandUploadGroupSiblings(matched, query);
  return orderAdminVideoJobsForIndex(withSiblings);
}

/**
 * Load only ids for neighbor navigation (same filters/order/expansion as the
 * index). Selects index-sort columns only — not full job rows.
 */
export async function listAdminVideoJobIds(
  query: AdminVideoJobsListQuery,
): Promise<string[]> {
  const matched = await queryMatchedAdminVideoJobIndexRows(query);
  const withSiblings = await expandUploadGroupSiblings(matched, query, {
    indexColumnsOnly: true,
  });
  return orderAdminVideoJobsForIndex(withSiblings).map((job) => job.id);
}
