import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
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
  frameCount?: number | null;
}): Promise<void> {
  const { job, totalMs } = params;

  const eligibility = isShadowEligible({
    totalMs,
    frameCount: params.frameCount ?? job.frameCount ?? 0,
    passRole: job.passRole,
  });

  if (!eligibility.eligible || !job.groupId) {
    return;
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, job.groupId),
        eq(schema.videoJobs.passRole, "shadow"),
      ),
    )
    .limit(1);

  if (existing) {
    return;
  }

  // Determine shadow config from experiment arm, if assigned
  let shadowConfig: ExtractionConfig = SHADOW_PASS_AB;
  let resolvedShadowPassKey = "scene_0.1";

  const [group] = await db
    .select({ experimentArmId: schema.videoUploadGroups.experimentArmId })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, job.groupId))
    .limit(1);

  if (group?.experimentArmId) {
    const [arm] = await db
      .select({ configId: schema.experimentArms.configId })
      .from(schema.experimentArms)
      .where(eq(schema.experimentArms.id, group.experimentArmId))
      .limit(1);

    if (arm) {
      if (arm.configId === null) {
        // Control arm with no configId — skip shadow pass
        return;
      }

      const [parseConfig] = await db
        .select({
          passKey: schema.parseConfigs.passKey,
          configJson: schema.parseConfigs.configJson,
        })
        .from(schema.parseConfigs)
        .where(eq(schema.parseConfigs.id, arm.configId))
        .limit(1);

      if (parseConfig) {
        shadowConfig = parseConfig.configJson as ExtractionConfig;
        resolvedShadowPassKey = parseConfig.passKey;
      }
    }
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
    passKey: resolvedShadowPassKey,
    passIndex: 1,
    passRole: "shadow",
    extractionConfigJson: shadowConfig,
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
