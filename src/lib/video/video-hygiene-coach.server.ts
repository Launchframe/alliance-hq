import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  selectVideoHygieneCoachTip,
  type VideoHygieneCoachTipId,
} from "@/lib/video/video-hygiene-coach.shared";
import { loadUploaderScoreTargetRewards } from "@/lib/video/video-hygiene-instrumentation.server";
import { recordVideoHygieneEvent } from "@/lib/video/video-hygiene-instrumentation.server";

const DISMISS_COOLDOWN_DAYS = 7;

export type ResolveCoachTipResult = {
  tipId: VideoHygieneCoachTipId;
  scoreTarget: string;
  jobCount: number;
} | null;

export async function resolveVideoHygieneCoachTip(params: {
  hqUserId: string;
  scoreTarget: string;
  days?: number;
}): Promise<ResolveCoachTipResult> {
  const picked = await pickVideoHygieneCoachTipForUploader(params);
  if (!picked) return null;

  if (
    await wasTipRecentlyDismissed(
      params.hqUserId,
      params.scoreTarget,
      picked.tipId,
    )
  ) {
    return null;
  }

  return picked;
}

/** Current coach signal for uploader × score target (ignores dismiss cooldown). */
export async function pickVideoHygieneCoachTipForUploader(params: {
  hqUserId: string;
  scoreTarget: string;
  days?: number;
}): Promise<ResolveCoachTipResult> {
  const days = params.days ?? 60;
  const rows = await loadUploaderScoreTargetRewards({
    days,
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
  });
  const row = rows.find(
    (r) =>
      r.hqUserId === params.hqUserId && r.scoreTarget === params.scoreTarget,
  );
  if (!row) return null;

  const tipId = selectVideoHygieneCoachTip({
    scoreTarget: params.scoreTarget,
    jobCount: row.jobCount,
    thumbsUpRate: row.thumbsUpRate,
    avgQualityScore: row.avgQualityScore,
    medianReviewDurationMs: row.medianReviewDurationMs,
    scrollStyleCounts: row.scrollStyleCounts,
  });
  if (!tipId) return null;

  return {
    tipId,
    scoreTarget: params.scoreTarget,
    jobCount: row.jobCount,
  };
}

async function wasTipRecentlyDismissed(
  hqUserId: string,
  scoreTarget: string,
  tipId: string,
): Promise<boolean> {
  const db = getDb();
  const recent = await db
    .select({ payload: schema.videoHygieneEvents.payload })
    .from(schema.videoHygieneEvents)
    .where(
      and(
        eq(schema.videoHygieneEvents.hqUserId, hqUserId),
        eq(schema.videoHygieneEvents.scoreTarget, scoreTarget),
        eq(schema.videoHygieneEvents.kind, "coach_dismissed"),
        gte(
          schema.videoHygieneEvents.createdAt,
          sql`now() - (${DISMISS_COOLDOWN_DAYS}::int * interval '1 day')`,
        ),
      ),
    )
    .orderBy(desc(schema.videoHygieneEvents.createdAt))
    .limit(20);

  return recent.some((row) => {
    const payload = row.payload;
    return (
      payload != null &&
      typeof payload === "object" &&
      "tipId" in payload &&
      payload.tipId === tipId
    );
  });
}

export async function recordCoachShown(params: {
  hqUserId: string;
  scoreTarget: string;
  tipId: VideoHygieneCoachTipId;
  allianceId?: string | null;
  jobId?: string | null;
}): Promise<void> {
  await recordVideoHygieneEvent({
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    kind: "coach_shown",
    payload: { tipId: params.tipId },
    allianceId: params.allianceId,
    jobId: params.jobId,
  });
}

export async function recordCoachDismissed(params: {
  hqUserId: string;
  scoreTarget: string;
  tipId: VideoHygieneCoachTipId;
  allianceId?: string | null;
}): Promise<void> {
  await recordVideoHygieneEvent({
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    kind: "coach_dismissed",
    payload: { tipId: params.tipId },
    allianceId: params.allianceId,
  });
}
