import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  aggregateUploaderScoreTargetRewards,
  type UploaderScoreTargetRewardRow,
} from "@/lib/video/video-hygiene-instrumentation.shared";
import { clampVideoJobsAnalyticsDays } from "@/lib/video/video-jobs-analytics.server";
import {
  detectAdaptOscillation,
  detectCoachSpam,
  detectCrossSignalConflict,
  detectWorseningAfterAdapt,
  learningDirectionFromWindows,
  type HygieneEventSnapshot,
  type LearningDirection,
  type ThrashFlag,
} from "@/lib/video/video-hygiene-learning.shared";

export type VideoLearningOfficerSummary = {
  hqUserId: string;
  displayName: string | null;
  email: string;
  jobCount: number;
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
  medianReviewDurationMs: number | null;
  activeAdaptOverlays: number;
  coachEventCount: number;
  adaptEventCount: number;
  learningDirection: LearningDirection;
  thrashFlags: ThrashFlag[];
};

export type VideoLearningFleetResponse = {
  days: number;
  summary: {
    officerCount: number;
    improvingCount: number;
    regressingCount: number;
    flatCount: number;
    officersWithAdaptBias: number;
    thrashFlagCount: number;
  };
  officers: VideoLearningOfficerSummary[];
};

export type VideoLearningOfficerDetailResponse = {
  days: number;
  officer: {
    hqUserId: string;
    displayName: string | null;
    email: string;
  };
  rewards: UploaderScoreTargetRewardRow[];
  learningDirection: LearningDirection;
  events: Array<{
    id: string;
    kind: string;
    scoreTarget: string;
    payload: Record<string, unknown> | null;
    jobId: string | null;
    createdAt: string;
  }>;
  recentJobs: Array<{
    id: string;
    scoreTarget: string | null;
    status: string;
    rating: string | null;
    qualityScore: number | null;
    reviewDurationMs: number | null;
    createdAt: string;
  }>;
  thrashFlags: ThrashFlag[];
};

type JobRewardSample = {
  hqUserId: string;
  scoreTarget: string;
  rating: string | null;
  qualityScore: number | null;
  reviewDurationMs: number | null;
  reviewRowsEdited: number | null;
  reviewRowsDeleted: number | null;
  reviewRowsAdded: number | null;
  scrollStyle: string | null;
  createdAt: Date;
};

function payloadAsRecord(
  payload: unknown,
): Record<string, unknown> | null {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function windowHalfRewards(
  jobs: JobRewardSample[],
): {
  early: ReturnType<typeof aggregateUploaderScoreTargetRewards>[number] | null;
  late: ReturnType<typeof aggregateUploaderScoreTargetRewards>[number] | null;
} {
  if (jobs.length === 0) return { early: null, late: null };
  const sorted = [...jobs].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const mid = Math.floor(sorted.length / 2);
  const earlyJobs = sorted.slice(0, Math.max(mid, 1));
  const lateJobs = sorted.slice(mid);
  const early = aggregateUploaderScoreTargetRewards(earlyJobs)[0] ?? null;
  const late = aggregateUploaderScoreTargetRewards(lateJobs)[0] ?? null;
  return { early, late };
}

async function loadJobSamples(params: {
  days: number;
  hqUserId?: string;
}): Promise<JobRewardSample[]> {
  const db = getDb();
  const days = clampVideoJobsAnalyticsDays(params.days);
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
  if (params.hqUserId) {
    conditions.push(eq(schema.videoJobs.enqueuedByHqUserId, params.hqUserId));
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
      createdAt: schema.videoJobs.createdAt,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.videoJobSurveys,
      eq(schema.videoJobSurveys.jobId, schema.videoJobs.id),
    )
    .where(and(...conditions));

  return rows
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
      createdAt: row.createdAt,
    }));
}

async function loadHygieneEvents(params: {
  days: number;
  hqUserId?: string;
}): Promise<
  Array<{
    id: string;
    hqUserId: string;
    kind: string;
    scoreTarget: string;
    payload: unknown;
    jobId: string | null;
    createdAt: Date;
  }>
> {
  const db = getDb();
  const days = clampVideoJobsAnalyticsDays(params.days);
  const conditions = [];
  if (days > 0) {
    conditions.push(
      gte(
        schema.videoHygieneEvents.createdAt,
        sql`now() - (${days}::int * interval '1 day')`,
      ),
    );
  }
  if (params.hqUserId) {
    conditions.push(eq(schema.videoHygieneEvents.hqUserId, params.hqUserId));
  }

  return db
    .select({
      id: schema.videoHygieneEvents.id,
      hqUserId: schema.videoHygieneEvents.hqUserId,
      kind: schema.videoHygieneEvents.kind,
      scoreTarget: schema.videoHygieneEvents.scoreTarget,
      payload: schema.videoHygieneEvents.payload,
      jobId: schema.videoHygieneEvents.jobId,
      createdAt: schema.videoHygieneEvents.createdAt,
    })
    .from(schema.videoHygieneEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.videoHygieneEvents.createdAt));
}

function thrashForOfficer(params: {
  hqUserId: string;
  events: HygieneEventSnapshot[];
  jobs: JobRewardSample[];
  rewardRows: UploaderScoreTargetRewardRow[];
}): ThrashFlag[] {
  const flags: ThrashFlag[] = [
    ...detectAdaptOscillation({
      hqUserId: params.hqUserId,
      events: params.events,
    }),
  ];

  const adaptBiasOnTargets = new Set<string>();
  const byTargetEvents = new Map<string, HygieneEventSnapshot[]>();
  for (const event of params.events) {
    const list = byTargetEvents.get(event.scoreTarget) ?? [];
    list.push(event);
    byTargetEvents.set(event.scoreTarget, list);
  }
  for (const [scoreTarget, list] of byTargetEvents) {
    const sorted = [...list]
      .filter(
        (e) => e.kind === "adapt_bias_on" || e.kind === "adapt_bias_off",
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    const last = sorted[sorted.length - 1];
    if (last?.kind === "adapt_bias_on") {
      adaptBiasOnTargets.add(scoreTarget);
    }
  }

  for (const row of params.rewardRows) {
    flags.push(
      ...detectCoachSpam({
        hqUserId: params.hqUserId,
        events: params.events.filter((e) => e.scoreTarget === row.scoreTarget),
        thumbsUpRate: row.thumbsUpRate,
        avgQualityScore: row.avgQualityScore,
      }),
    );

    const targetJobs = params.jobs.filter(
      (j) => j.scoreTarget === row.scoreTarget,
    );
    const { early, late } = windowHalfRewards(targetJobs);
    const hadAdaptOn = params.events.some(
      (e) =>
        e.scoreTarget === row.scoreTarget && e.kind === "adapt_bias_on",
    );
    const worsen = detectWorseningAfterAdapt({
      hqUserId: params.hqUserId,
      scoreTarget: row.scoreTarget,
      hadAdaptOn,
      earlyThumbsUpRate: early?.thumbsUpRate ?? null,
      lateThumbsUpRate: late?.thumbsUpRate ?? null,
      earlyAvgQuality: early?.avgQualityScore ?? null,
      lateAvgQuality: late?.avgQualityScore ?? null,
    });
    if (worsen) flags.push(worsen);
  }

  flags.push(
    ...detectCrossSignalConflict({
      hqUserId: params.hqUserId,
      events: params.events,
      adaptBiasOnTargets,
    }),
  );

  return flags;
}

export async function loadVideoLearningFleet(
  daysRaw: number,
): Promise<VideoLearningFleetResponse> {
  const days = clampVideoJobsAnalyticsDays(daysRaw) || 30;
  const [jobs, events] = await Promise.all([
    loadJobSamples({ days }),
    loadHygieneEvents({ days }),
  ]);

  const rewards = aggregateUploaderScoreTargetRewards(jobs);
  const byUserRewards = new Map<string, UploaderScoreTargetRewardRow[]>();
  for (const row of rewards) {
    const list = byUserRewards.get(row.hqUserId) ?? [];
    list.push(row);
    byUserRewards.set(row.hqUserId, list);
  }

  const userIds = [...byUserRewards.keys()];
  const db = getDb();
  const users =
    userIds.length === 0
      ? []
      : await db
          .select({
            id: schema.hqUsers.id,
            email: schema.hqUsers.email,
            displayName: schema.hqUsers.displayName,
          })
          .from(schema.hqUsers)
          .where(inArray(schema.hqUsers.id, userIds));
  const userById = new Map(users.map((u) => [u.id, u]));

  const officers: VideoLearningOfficerSummary[] = [];

  for (const [hqUserId, rewardRows] of byUserRewards) {
    const userJobs = jobs.filter((j) => j.hqUserId === hqUserId);
    const userEvents = events
      .filter((e) => e.hqUserId === hqUserId)
      .map(
        (e): HygieneEventSnapshot => ({
          kind: e.kind,
          scoreTarget: e.scoreTarget,
          createdAt: e.createdAt,
          payload: payloadAsRecord(e.payload),
        }),
      );

    const { early, late } = windowHalfRewards(userJobs);
    const learningDirection = learningDirectionFromWindows({
      earlyThumbsUpRate: early?.thumbsUpRate ?? null,
      lateThumbsUpRate: late?.thumbsUpRate ?? null,
      earlyAvgQuality: early?.avgQualityScore ?? null,
      lateAvgQuality: late?.avgQualityScore ?? null,
    });

    const thrashFlags = thrashForOfficer({
      hqUserId,
      events: userEvents,
      jobs: userJobs,
      rewardRows,
    });

    // Count active overlays from last adapt_bias_* per target
    const targets = new Set(rewardRows.map((r) => r.scoreTarget));
    let activeAdaptOverlays = 0;
    for (const scoreTarget of targets) {
      const sorted = userEvents
        .filter(
          (e) =>
            e.scoreTarget === scoreTarget &&
            (e.kind === "adapt_bias_on" || e.kind === "adapt_bias_off"),
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      if (sorted[sorted.length - 1]?.kind === "adapt_bias_on") {
        activeAdaptOverlays += 1;
      }
    }

    const jobCount = rewardRows.reduce((n, r) => n + r.jobCount, 0);
    const rated = rewardRows.reduce((n, r) => n + r.ratedCount, 0);
    const thumbsUp = rewardRows.reduce((n, r) => n + r.thumbsUpCount, 0);
    const qualityScores = rewardRows
      .map((r) => r.avgQualityScore)
      .filter((v): v is number => v != null);
    const reviewMs = rewardRows
      .map((r) => r.medianReviewDurationMs)
      .filter((v): v is number => v != null);

    const user = userById.get(hqUserId);
    officers.push({
      hqUserId,
      displayName: user?.displayName ?? null,
      email: user?.email ?? hqUserId,
      jobCount,
      thumbsUpRate: rated === 0 ? null : thumbsUp / rated,
      avgQualityScore:
        qualityScores.length === 0
          ? null
          : qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length,
      medianReviewDurationMs:
        reviewMs.length === 0
          ? null
          : reviewMs.reduce((a, b) => a + b, 0) / reviewMs.length,
      activeAdaptOverlays,
      coachEventCount: userEvents.filter(
        (e) => e.kind === "coach_shown" || e.kind === "coach_dismissed",
      ).length,
      adaptEventCount: userEvents.filter((e) =>
        e.kind.startsWith("adapt_"),
      ).length,
      learningDirection,
      thrashFlags,
    });
  }

  officers.sort((a, b) => b.jobCount - a.jobCount);

  const summary = {
    officerCount: officers.length,
    improvingCount: officers.filter((o) => o.learningDirection === "improving")
      .length,
    regressingCount: officers.filter(
      (o) => o.learningDirection === "regressing",
    ).length,
    flatCount: officers.filter((o) => o.learningDirection === "flat").length,
    officersWithAdaptBias: officers.filter((o) => o.activeAdaptOverlays > 0)
      .length,
    thrashFlagCount: officers.reduce((n, o) => n + o.thrashFlags.length, 0),
  };

  return { days, summary, officers };
}

export async function loadVideoLearningOfficerDetail(params: {
  hqUserId: string;
  daysRaw: number;
}): Promise<VideoLearningOfficerDetailResponse | null> {
  const days = clampVideoJobsAnalyticsDays(params.daysRaw) || 30;
  const db = getDb();
  const [user] = await db
    .select({
      id: schema.hqUsers.id,
      email: schema.hqUsers.email,
      displayName: schema.hqUsers.displayName,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, params.hqUserId))
    .limit(1);
  if (!user) return null;

  const [jobs, events, recentJobs] = await Promise.all([
    loadJobSamples({ days, hqUserId: params.hqUserId }),
    loadHygieneEvents({ days, hqUserId: params.hqUserId }),
    (async () => {
      const recentConditions = [
        eq(schema.videoJobs.enqueuedByHqUserId, params.hqUserId),
        sql`${schema.videoJobs.passRole} is distinct from 'shadow'`,
      ];
      if (days > 0) {
        recentConditions.push(
          gte(
            schema.videoJobs.createdAt,
            sql`now() - (${days}::int * interval '1 day')`,
          ),
        );
      }
      return db
        .select({
          id: schema.videoJobs.id,
          scoreTarget: schema.videoJobs.scoreTarget,
          status: schema.videoJobs.status,
          rating: schema.videoJobs.rating,
          qualityScore: schema.videoJobs.qualityScore,
          reviewDurationMs: schema.videoJobs.reviewDurationMs,
          createdAt: schema.videoJobs.createdAt,
        })
        .from(schema.videoJobs)
        .where(and(...recentConditions))
        .orderBy(desc(schema.videoJobs.createdAt))
        .limit(25);
    })(),
  ]);

  const rewards = aggregateUploaderScoreTargetRewards(jobs);
  const eventSnapshots: HygieneEventSnapshot[] = events.map((e) => ({
    kind: e.kind,
    scoreTarget: e.scoreTarget,
    createdAt: e.createdAt,
    payload: payloadAsRecord(e.payload),
  }));
  const { early, late } = windowHalfRewards(jobs);
  const learningDirection = learningDirectionFromWindows({
    earlyThumbsUpRate: early?.thumbsUpRate ?? null,
    lateThumbsUpRate: late?.thumbsUpRate ?? null,
    earlyAvgQuality: early?.avgQualityScore ?? null,
    lateAvgQuality: late?.avgQualityScore ?? null,
  });
  const thrashFlags = thrashForOfficer({
    hqUserId: params.hqUserId,
    events: eventSnapshots,
    jobs,
    rewardRows: rewards,
  });

  return {
    days,
    officer: {
      hqUserId: user.id,
      displayName: user.displayName,
      email: user.email,
    },
    rewards,
    learningDirection,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      scoreTarget: e.scoreTarget,
      payload: payloadAsRecord(e.payload),
      jobId: e.jobId,
      createdAt: e.createdAt.toISOString(),
    })),
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      scoreTarget: j.scoreTarget,
      status: j.status,
      rating: j.rating,
      qualityScore: j.qualityScore,
      reviewDurationMs: j.reviewDurationMs,
      createdAt: j.createdAt.toISOString(),
    })),
    thrashFlags,
  };
}
