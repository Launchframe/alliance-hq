import "server-only";

import { and, asc, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { VideoJob } from "@/lib/db/schema";
import {
  isAllianceHqOcrOnlyLockedOnDeploy,
  loadEffectiveAllianceHqOcrOnly,
} from "@/lib/video/alliance-ocr-settings.server";
import {
  resolveVideoOcrEngineForJob,
  engineRequiresAshed,
  videoOcrRequiresAshedConnection,
} from "@/lib/video/ocr-provider.shared";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import { isMemberRosterVideoTarget } from "@/lib/video/score-targets";
import type {
  VideoProcessExperimentOption,
  VideoProcessPreview,
} from "@/lib/video/video-process-preview.shared";
import { buildVideoProcessShadowFollowups } from "@/lib/video/video-process-preview.shared";

async function listActiveExperimentOptions(params: {
  scoreTarget: string;
  boardKey: string | null;
}): Promise<VideoProcessExperimentOption[]> {
  const db = getDb();
  const campaigns = await db
    .select({
      id: schema.experimentCampaigns.id,
      name: schema.experimentCampaigns.name,
      boardKey: schema.experimentCampaigns.boardKey,
      createdAt: schema.experimentCampaigns.createdAt,
    })
    .from(schema.experimentCampaigns)
    .where(
      and(
        eq(schema.experimentCampaigns.status, "active"),
        eq(schema.experimentCampaigns.scoreTarget, params.scoreTarget),
        or(
          params.boardKey
            ? eq(schema.experimentCampaigns.boardKey, params.boardKey)
            : isNull(schema.experimentCampaigns.boardKey),
          isNull(schema.experimentCampaigns.boardKey),
        ),
      ),
    )
    .orderBy(asc(schema.experimentCampaigns.createdAt));

  const boardSpecific = params.boardKey
    ? campaigns.filter((row) => row.boardKey === params.boardKey)
    : campaigns.filter((row) => row.boardKey === null);
  const eligibleCampaigns =
    boardSpecific.length > 0
      ? boardSpecific
      : campaigns.filter((row) => row.boardKey === null);

  const options: VideoProcessExperimentOption[] = [];
  for (const campaign of eligibleCampaigns) {
    const arms = await db
      .select({
        id: schema.experimentArms.id,
        name: schema.experimentArms.name,
        isControl: schema.experimentArms.isControl,
      })
      .from(schema.experimentArms)
      .where(eq(schema.experimentArms.campaignId, campaign.id))
      .orderBy(asc(schema.experimentArms.createdAt));

    for (const arm of arms) {
      options.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        armId: arm.id,
        armName: arm.name,
        isControl: arm.isControl,
      });
    }
  }

  return options;
}

async function resolveCurrentExperiment(
  groupId: string | null,
): Promise<{
  experiment: VideoProcessExperimentOption | null;
  armConfigId: string | null;
  isControl: boolean;
}> {
  if (!groupId) {
    return { experiment: null, armConfigId: null, isControl: false };
  }

  const db = getDb();
  const [group] = await db
    .select({
      experimentCampaignId: schema.videoUploadGroups.experimentCampaignId,
      experimentArmId: schema.videoUploadGroups.experimentArmId,
    })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, groupId))
    .limit(1);

  if (!group?.experimentArmId || !group.experimentCampaignId) {
    return { experiment: null, armConfigId: null, isControl: false };
  }

  const [arm] = await db
    .select({
      id: schema.experimentArms.id,
      name: schema.experimentArms.name,
      isControl: schema.experimentArms.isControl,
      configId: schema.experimentArms.configId,
      campaignId: schema.experimentArms.campaignId,
    })
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.id, group.experimentArmId))
    .limit(1);

  const [campaign] = await db
    .select({ name: schema.experimentCampaigns.name })
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, group.experimentCampaignId))
    .limit(1);

  if (!arm || !campaign) {
    return { experiment: null, armConfigId: null, isControl: false };
  }

  return {
    experiment: {
      campaignId: group.experimentCampaignId,
      campaignName: campaign.name,
      armId: arm.id,
      armName: arm.name,
      isControl: arm.isControl,
    },
    armConfigId: arm.configId,
    isControl: arm.isControl,
  };
}

export async function buildVideoProcessPreview(params: {
  job: VideoJob;
  sessionId: string;
}): Promise<VideoProcessPreview> {
  const scoreTargetId =
    params.job.scoreTarget ?? params.job.category ?? "desert-storm";
  const isRosterTarget = isMemberRosterVideoTarget(scoreTargetId);
  const allianceId = params.job.allianceId;
  const hqOcrOnly = allianceId
    ? await loadEffectiveAllianceHqOcrOnly(allianceId)
    : false;
  const ocrContext = { allianceHqOcrOnly: hqOcrOnly };
  const primaryEngine = resolveVideoOcrEngineForJob(
    scoreTargetId,
    isRosterTarget,
    ocrContext,
  );

  const [{ experiment, armConfigId }, experimentOptions, canProcess] =
    await Promise.all([
      resolveCurrentExperiment(params.job.groupId),
      listActiveExperimentOptions({
        scoreTarget: scoreTargetId,
        boardKey: params.job.boardKey,
      }),
      sessionCanProcessVideo(params.sessionId),
    ]);

  const envRequiresAshed = videoOcrRequiresAshedConnection();
  const requiresAshedConnection =
    canProcess && !hqOcrOnly && envRequiresAshed && engineRequiresAshed(primaryEngine);

  return {
    jobId: params.job.id,
    status: params.job.status,
    fileName: params.job.fileName,
    fileSizeBytes: params.job.fileSizeBytes,
    scoreTarget: params.job.scoreTarget ?? params.job.category,
    boardKey: params.job.boardKey,
    passKey: params.job.passKey,
    primaryEngine,
    shadowFollowups: buildVideoProcessShadowFollowups({
      primaryEngine,
      isRosterTarget,
      experimentArmConfigId: armConfigId,
      hasExperimentAssignment: experiment != null,
    }),
    experiment,
    experimentOptions,
    hqOcrOnly,
    hqOcrOnlyLocked: isAllianceHqOcrOnlyLockedOnDeploy(),
    requiresAshedConnection,
    canProcess,
  };
}

export async function setVideoUploadGroupExperiment(params: {
  groupId: string;
  campaignId: string | null;
  armId: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();

  if (!params.armId || !params.campaignId) {
    await db
      .update(schema.videoUploadGroups)
      .set({
        experimentCampaignId: null,
        experimentArmId: null,
        updatedAt: now,
      })
      .where(eq(schema.videoUploadGroups.id, params.groupId));
    return;
  }

  const [arm] = await db
    .select({
      id: schema.experimentArms.id,
      campaignId: schema.experimentArms.campaignId,
    })
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.id, params.armId))
    .limit(1);

  if (!arm || arm.campaignId !== params.campaignId) {
    throw new Error("Invalid experiment arm.");
  }

  await db
    .update(schema.videoUploadGroups)
    .set({
      experimentCampaignId: params.campaignId,
      experimentArmId: params.armId,
      updatedAt: now,
    })
    .where(eq(schema.videoUploadGroups.id, params.groupId));
}
