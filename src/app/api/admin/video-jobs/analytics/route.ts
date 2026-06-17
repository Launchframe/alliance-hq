import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export type PassKeyRow = {
  passKey: string;
  scoreTarget: string;
  total: number;
  rated: number;
  thumbsUp: number;
  thumbsDown: number;
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
  userSelected: number;
  sysRecommended: number;
  agreementRate: number | null;
};

export type BucketRow = {
  passKey: string;
  scoreTarget: string;
  qualityBucket: string;
  count: number;
};

export type ReasonRow = {
  ratingReason: string;
  scoreTarget: string;
  count: number;
};

export type TargetRow = {
  scoreTarget: string;
  total: number;
  rated: number;
  thumbsUp: number;
  thumbsUpRate: number | null;
};

export type DailySeriesRow = {
  date: string;
  scoreTarget: string;
  passKey: string;
  rated: number;
  thumbsUp: number;
};

export type RecommendationAccuracy = {
  totalDecided: number;
  accurate: number;
  overridden: number;
  accuracyRate: number | null;
  overrideRate: number | null;
};

export type AnalyticsSummary = {
  totalJobs: number;
  ratedJobs: number;
  thumbsUp: number;
  thumbsDown: number;
  thumbsUpRate: number | null;
};

export type AnalyticsResponse = {
  summary: AnalyticsSummary;
  mixedEventTypes: boolean;
  recommendationAccuracy: RecommendationAccuracy;
  byPassKey: PassKeyRow[];
  byQualityBucket: BucketRow[];
  byScoreTarget: TargetRow[];
  byRatingReason: ReasonRow[];
  dailySeries: DailySeriesRow[];
};

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const scoreTargetFilter = url.searchParams.get("scoreTarget");
  const passKeyFilter = url.searchParams.get("passKey");
  const days = Number(url.searchParams.get("days") ?? 0);

  const db = getDb();

  const dateFilter =
    days > 0
      ? sql`${schema.videoJobs.createdAt} >= now() - ${sql.raw(`'${days} days'::interval`)}`
      : undefined;

  const scoreTargetCondition = scoreTargetFilter
    ? eq(schema.videoJobs.scoreTarget, scoreTargetFilter)
    : undefined;

  const passKeyCondition = passKeyFilter
    ? eq(schema.videoJobs.passKey, passKeyFilter)
    : undefined;

  const jobConditions = [
    isNotNull(schema.videoJobs.passKey),
    dateFilter,
    scoreTargetCondition,
    passKeyCondition,
  ].filter(Boolean) as Parameters<typeof and>;

  // ── 1. Pass-key × scoreTarget aggregate ──────────────────────────────────
  const passKeyRows = await db
    .select({
      passKey: schema.videoJobs.passKey,
      scoreTarget: schema.videoJobs.scoreTarget,
      total: sql<number>`count(*)::int`,
      rated: sql<number>`count(*) filter (where ${schema.videoJobs.rating} is not null)::int`,
      thumbsUp: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'up')::int`,
      thumbsDown: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'down')::int`,
      avgQualityScore: sql<number | null>`avg(${schema.videoJobs.qualityScore})::real`,
      userSelected: sql<number>`count(*) filter (where ${schema.videoUploadGroups.selectedJobId} = ${schema.videoJobs.id})::int`,
      sysRecommended: sql<number>`count(*) filter (where ${schema.videoUploadGroups.comparisonJson}->>'recommendedJobId' = ${schema.videoJobs.id})::int`,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.videoUploadGroups,
      eq(schema.videoUploadGroups.id, schema.videoJobs.groupId),
    )
    .where(jobConditions.length > 0 ? and(...jobConditions) : undefined)
    .groupBy(schema.videoJobs.passKey, schema.videoJobs.scoreTarget)
    .orderBy(schema.videoJobs.scoreTarget, schema.videoJobs.passKey);

  // ── 2. Quality bucket distribution ───────────────────────────────────────
  const bucketRows = await db
    .select({
      passKey: schema.videoJobs.passKey,
      scoreTarget: schema.videoJobs.scoreTarget,
      qualityBucket: schema.videoJobs.qualityBucket,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.videoJobs)
    .where(
      and(
        isNotNull(schema.videoJobs.passKey),
        isNotNull(schema.videoJobs.qualityBucket),
        ...(scoreTargetCondition ? [scoreTargetCondition] : []),
        ...(passKeyCondition ? [passKeyCondition] : []),
        ...(dateFilter ? [dateFilter] : []),
      ),
    )
    .groupBy(
      schema.videoJobs.passKey,
      schema.videoJobs.scoreTarget,
      schema.videoJobs.qualityBucket,
    )
    .orderBy(schema.videoJobs.scoreTarget, schema.videoJobs.passKey);

  // ── 3. Rating reason breakdown ────────────────────────────────────────────
  const reasonRows = await db
    .select({
      ratingReason: schema.videoJobs.ratingReason,
      scoreTarget: schema.videoJobs.scoreTarget,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.videoJobs)
    .where(
      and(
        isNotNull(schema.videoJobs.ratingReason),
        ...(scoreTargetCondition ? [scoreTargetCondition] : []),
        ...(dateFilter ? [dateFilter] : []),
      ),
    )
    .groupBy(schema.videoJobs.ratingReason, schema.videoJobs.scoreTarget)
    .orderBy(schema.videoJobs.scoreTarget);

  // ── 4. Per-scoreTarget summary ────────────────────────────────────────────
  const targetRows = await db
    .select({
      scoreTarget: schema.videoJobs.scoreTarget,
      total: sql<number>`count(*)::int`,
      rated: sql<number>`count(*) filter (where ${schema.videoJobs.rating} is not null)::int`,
      thumbsUp: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'up')::int`,
    })
    .from(schema.videoJobs)
    .where(
      and(
        isNotNull(schema.videoJobs.scoreTarget),
        ...(dateFilter ? [dateFilter] : []),
        ...(passKeyCondition ? [passKeyCondition] : []),
      ),
    )
    .groupBy(schema.videoJobs.scoreTarget)
    .orderBy(schema.videoJobs.scoreTarget);

  // ── 5. Recommendation accuracy ────────────────────────────────────────────
  const recAccConditions = [
    isNotNull(schema.videoUploadGroups.comparisonJson),
    ...(scoreTargetFilter
      ? [eq(schema.videoUploadGroups.scoreTarget, scoreTargetFilter)]
      : []),
    ...(days > 0
      ? [
          sql`${schema.videoUploadGroups.createdAt} >= now() - ${sql.raw(`'${days} days'::interval`)}`,
        ]
      : []),
  ].filter(Boolean) as Parameters<typeof and>;

  const [recAccRow] = await db
    .select({
      totalDecided: sql<number>`count(*) filter (where ${schema.videoUploadGroups.selectedJobId} is not null)::int`,
      accurate: sql<number>`count(*) filter (
        where ${schema.videoUploadGroups.selectedJobId} is not null
          and ${schema.videoUploadGroups.selectedJobId} = ${schema.videoUploadGroups.comparisonJson}->>'recommendedJobId'
      )::int`,
      overridden: sql<number>`count(*) filter (
        where ${schema.videoUploadGroups.selectedJobId} is not null
          and ${schema.videoUploadGroups.selectedJobId} != ${schema.videoUploadGroups.comparisonJson}->>'recommendedJobId'
      )::int`,
    })
    .from(schema.videoUploadGroups)
    .where(recAccConditions.length > 0 ? and(...recAccConditions) : undefined);

  // ── 6. Daily time-series (last 90 days, capped) ──────────────────────────
  const seriesDays = days > 0 ? Math.min(days, 90) : 90;
  const dailyRows = await db
    .select({
      date: sql<string>`date_trunc('day', ${schema.videoJobs.createdAt})::date::text`,
      scoreTarget: schema.videoJobs.scoreTarget,
      passKey: schema.videoJobs.passKey,
      rated: sql<number>`count(*) filter (where ${schema.videoJobs.rating} is not null)::int`,
      thumbsUp: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'up')::int`,
    })
    .from(schema.videoJobs)
    .where(
      and(
        isNotNull(schema.videoJobs.passKey),
        isNotNull(schema.videoJobs.scoreTarget),
        sql`${schema.videoJobs.createdAt} >= now() - ${sql.raw(`'${seriesDays} days'::interval`)}`,
        ...(scoreTargetCondition ? [scoreTargetCondition] : []),
        ...(passKeyCondition ? [passKeyCondition] : []),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${schema.videoJobs.createdAt})::date`,
      schema.videoJobs.scoreTarget,
      schema.videoJobs.passKey,
    )
    .orderBy(sql`1`, schema.videoJobs.scoreTarget, schema.videoJobs.passKey);

  // ── 7. Overall summary ────────────────────────────────────────────────────
  const summaryConditions = [
    ...(scoreTargetCondition ? [scoreTargetCondition] : []),
    ...(dateFilter ? [dateFilter] : []),
  ];

  const [summaryRow] = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      ratedJobs: sql<number>`count(*) filter (where ${schema.videoJobs.rating} is not null)::int`,
      thumbsUp: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'up')::int`,
      thumbsDown: sql<number>`count(*) filter (where ${schema.videoJobs.rating} = 'down')::int`,
    })
    .from(schema.videoJobs)
    .where(
      summaryConditions.length > 0 ? and(...summaryConditions) : undefined,
    );

  // ── Build response ────────────────────────────────────────────────────────
  const distinctScoreTargets = new Set(
    passKeyRows.map((r) => r.scoreTarget).filter(Boolean),
  );
  const mixedEventTypes = !scoreTargetFilter && distinctScoreTargets.size > 1;

  const totalDecided = recAccRow?.totalDecided ?? 0;
  const accurate = recAccRow?.accurate ?? 0;
  const overridden = recAccRow?.overridden ?? 0;

  const total = summaryRow?.totalJobs ?? 0;
  const rated = summaryRow?.ratedJobs ?? 0;
  const up = summaryRow?.thumbsUp ?? 0;
  const down = summaryRow?.thumbsDown ?? 0;

  const byPassKey: PassKeyRow[] = passKeyRows.map((r) => {
    const ratedCount = r.rated ?? 0;
    const upCount = r.thumbsUp ?? 0;
    const selCount = r.userSelected ?? 0;
    const recCount = r.sysRecommended ?? 0;
    const selAndRec =
      selCount > 0 && recCount > 0
        ? Math.min(selCount, recCount)
        : null;
    return {
      passKey: r.passKey ?? "",
      scoreTarget: r.scoreTarget ?? "",
      total: r.total ?? 0,
      rated: ratedCount,
      thumbsUp: upCount,
      thumbsDown: r.thumbsDown ?? 0,
      thumbsUpRate: ratedCount > 0 ? upCount / ratedCount : null,
      avgQualityScore: r.avgQualityScore ?? null,
      userSelected: selCount,
      sysRecommended: recCount,
      agreementRate: selAndRec !== null ? selAndRec / Math.max(selCount, recCount) : null,
    };
  });

  const response: AnalyticsResponse = {
    summary: {
      totalJobs: total,
      ratedJobs: rated,
      thumbsUp: up,
      thumbsDown: down,
      thumbsUpRate: rated > 0 ? up / rated : null,
    },
    mixedEventTypes,
    recommendationAccuracy: {
      totalDecided,
      accurate,
      overridden,
      accuracyRate: totalDecided > 0 ? accurate / totalDecided : null,
      overrideRate: totalDecided > 0 ? overridden / totalDecided : null,
    },
    byPassKey,
    byQualityBucket: bucketRows.map((r) => ({
      passKey: r.passKey ?? "",
      scoreTarget: r.scoreTarget ?? "",
      qualityBucket: r.qualityBucket ?? "",
      count: r.count ?? 0,
    })),
    byScoreTarget: targetRows.map((r) => {
      const ratedCount = r.rated ?? 0;
      const upCount = r.thumbsUp ?? 0;
      return {
        scoreTarget: r.scoreTarget ?? "",
        total: r.total ?? 0,
        rated: ratedCount,
        thumbsUp: upCount,
        thumbsUpRate: ratedCount > 0 ? upCount / ratedCount : null,
      };
    }),
    byRatingReason: reasonRows.map((r) => ({
      ratingReason: r.ratingReason ?? "",
      scoreTarget: r.scoreTarget ?? "",
      count: r.count ?? 0,
    })),
    dailySeries: dailyRows.map((r) => ({
      date: r.date ?? "",
      scoreTarget: r.scoreTarget ?? "",
      passKey: r.passKey ?? "",
      rated: r.rated ?? 0,
      thumbsUp: r.thumbsUp ?? 0,
    })),
  };

  return NextResponse.json(response);
}
