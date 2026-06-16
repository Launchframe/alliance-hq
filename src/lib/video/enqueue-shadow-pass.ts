import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import { SHADOW_PASS_AB } from "@/lib/video/pass-definitions";

export type ShadowEligibility = {
  eligible: boolean;
  reason: string;
};

export function isShadowEligible(params: {
  totalMs: number;
  frameCount: number;
  passRole: string | null;
}): ShadowEligibility {
  if (params.passRole !== "primary") {
    return { eligible: false, reason: "not_primary" };
  }
  if (params.totalMs >= 30_000) {
    return { eligible: false, reason: "too_slow" };
  }
  if (params.frameCount >= 12) {
    return { eligible: false, reason: "too_many_frames" };
  }
  return { eligible: true, reason: "eligible" };
}

export async function maybeEnqueueShadowPass(params: {
  job: {
    id: string;
    sessionId: string;
    allianceId: string | null;
    scoreTarget: string | null;
    category: string | null;
    storageKey: string | null;
    boardKey: string | null;
    hqEventId: string | null;
    groupId: string | null;
    passRole: string | null;
    frameCount: number | null;
    hqUserId: string | null;
  };
  totalMs: number;
}): Promise<void> {
  const { job, totalMs } = params;

  const eligibility = isShadowEligible({
    totalMs,
    frameCount: job.frameCount ?? 0,
    passRole: job.passRole,
  });

  if (!eligibility.eligible || !job.groupId) {
    return;
  }

  const db = getDb();

  const shadowPassKey = "scene_0.1";
  const [existing] = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, job.groupId),
        eq(schema.videoJobs.passKey, shadowPassKey),
      ),
    )
    .limit(1);

  if (existing) {
    return;
  }

  const shadowJobId = nanoid(16);
  const now = new Date();

  await db.insert(schema.videoJobs).values({
    id: shadowJobId,
    sessionId: job.sessionId,
    allianceId: job.allianceId,
    hqUserId: job.hqUserId,
    scoreTarget: job.scoreTarget ?? job.category,
    category: job.category,
    boardKey: job.boardKey,
    hqEventId: job.hqEventId,
    storageKey: job.storageKey,
    groupId: job.groupId,
    passKey: shadowPassKey,
    passIndex: 1,
    passRole: "shadow",
    extractionConfigJson: SHADOW_PASS_AB,
    status: "queued",
    fileName: null,
    fileSizeBytes: null,
    frameCount: null,
    uploadedFrameCount: null,
    parseSessionId: null,
    errorMessage: null,
    timingsJson: null,
    totalFileSizeBytes: null,
    ingestMethod: "video",
    createdAt: now,
    updatedAt: now,
  });

  void dispatchVideoProcessing(shadowJobId, { source: "shadow_pass" }).catch(
    (err: unknown) => {
      console.error("[shadow-pass] dispatch failed", err);
    },
  );
}
