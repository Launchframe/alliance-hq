import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import {
  adHocReprocessCampaignName,
  extractionConfigsEqual,
  isAdminReprocessFpsAdjustment,
  normalizeExtractionConfig,
  passKeyForExtractionConfig,
  resolveAdminReprocessExtraction,
  type AdminReprocessExtractionRequest,
  type AdminReprocessFpsAdjustment,
} from "@/lib/video/admin-reprocess-extraction.shared";
import { resetVideoJobForReprocess } from "@/lib/video/reset-video-job-for-reprocess";

export type AdminReprocessResult = {
  jobId: string;
  status: "queued";
  previousPassKey: string | null;
  nextPassKey: string | null;
  changed: boolean;
  campaignId: string | null;
  armId: string | null;
};

export class AdminReprocessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminReprocessError";
  }
}

function parseRequestBody(raw: unknown): AdminReprocessExtractionRequest {
  if (raw == null || typeof raw !== "object") {
    return {};
  }
  const body = raw as Record<string, unknown>;
  const result: AdminReprocessExtractionRequest = {};

  if (body.adjustment !== undefined) {
    if (!isAdminReprocessFpsAdjustment(body.adjustment)) {
      throw new AdminReprocessError(
        'adjustment must be "keep", "increase", or "decrease".',
        400,
      );
    }
    result.adjustment = body.adjustment;
  }

  if (body.extraction !== undefined) {
    const extraction = normalizeExtractionConfig(body.extraction);
    if (!extraction) {
      throw new AdminReprocessError(
        "extraction must include valid mode and sampling values.",
        400,
      );
    }
    result.extraction = extraction;
  }

  if (body.parseConfigId !== undefined) {
    if (typeof body.parseConfigId !== "string" || !body.parseConfigId.trim()) {
      throw new AdminReprocessError("parseConfigId must be a non-empty string.", 400);
    }
    result.parseConfigId = body.parseConfigId.trim();
  }

  return result;
}

async function upsertParseConfigForExtraction(params: {
  config: ExtractionConfig;
  passKey: string;
  createdByUserId: string | null;
}): Promise<string> {
  const db = getDb();
  const existing = await db
    .select()
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.passKey, params.passKey));

  const match = existing.find((row) => {
    const normalized = normalizeExtractionConfig(row.configJson);
    return normalized != null && extractionConfigsEqual(normalized, params.config);
  });

  if (match) {
    if (match.status !== "active") {
      await db
        .update(schema.parseConfigs)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(schema.parseConfigs.id, match.id));
    }
    return match.id;
  }

  const id = nanoid(16);
  const now = new Date();
  await db.insert(schema.parseConfigs).values({
    id,
    name: params.passKey,
    passKey: params.passKey,
    description: "Created by admin ad-hoc reprocess",
    configJson: params.config,
    status: "active",
    notes: null,
    createdByUserId: params.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function ensureAdHocCampaign(params: {
  scoreTarget: string;
  createdByUserId: string | null;
}): Promise<string> {
  const db = getDb();
  const name = adHocReprocessCampaignName(params.scoreTarget);
  const [existing] = await db
    .select({ id: schema.experimentCampaigns.id })
    .from(schema.experimentCampaigns)
    .where(
      and(
        eq(schema.experimentCampaigns.name, name),
        eq(schema.experimentCampaigns.scoreTarget, params.scoreTarget),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.experimentCampaigns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(schema.experimentCampaigns.id, existing.id));
    return existing.id;
  }

  const id = nanoid(16);
  const now = new Date();
  await db.insert(schema.experimentCampaigns).values({
    id,
    name,
    description:
      "System campaign for admin reprocess trials. Paused so it never receives upload traffic.",
    hypothesis: null,
    scoreTarget: params.scoreTarget,
    boardKey: null,
    trafficPercent: 100,
    status: "paused",
    startedAt: null,
    concludedAt: null,
    conclusion: null,
    createdByUserId: params.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function ensureAdHocArm(params: {
  campaignId: string;
  configId: string;
  passKey: string;
}): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.experimentArms.id })
    .from(schema.experimentArms)
    .where(
      and(
        eq(schema.experimentArms.campaignId, params.campaignId),
        eq(schema.experimentArms.configId, params.configId),
      ),
    )
    .limit(1);

  if (existing) return existing.id;

  const id = nanoid(16);
  await db.insert(schema.experimentArms).values({
    id,
    campaignId: params.campaignId,
    name: params.passKey,
    isControl: false,
    configId: params.configId,
    trafficWeight: 50,
    createdAt: new Date(),
  });
  return id;
}

async function ensureJobHasGroup(job: {
  id: string;
  groupId: string | null;
  sessionId: string;
  allianceId: string | null;
  storageKey: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  scoreTarget: string | null;
  category: string | null;
  boardKey: string | null;
  hqEventId: string | null;
}): Promise<string> {
  if (job.groupId) return job.groupId;

  const db = getDb();
  const groupId = nanoid(16);
  const now = new Date();
  const scoreTarget = job.scoreTarget ?? job.category ?? "unknown";

  await db.insert(schema.videoUploadGroups).values({
    id: groupId,
    sessionId: job.sessionId,
    allianceId: job.allianceId,
    storageKey: job.storageKey,
    fileName: job.fileName,
    fileSizeBytes: job.fileSizeBytes,
    scoreTarget,
    boardKey: job.boardKey,
    hqEventId: job.hqEventId,
    primaryJobId: job.id,
    selectedJobId: job.id,
    accuracyJobId: null,
    comparisonJson: null,
    experimentCampaignId: null,
    experimentArmId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .update(schema.videoJobs)
    .set({ groupId, updatedAt: now })
    .where(eq(schema.videoJobs.id, job.id));

  return groupId;
}

/**
 * Stamp extraction + ad-hoc experiment attribution when config changes, then
 * reset the job for reprocess. Keep leaves experiment IDs alone.
 */
export async function adminReprocessVideoJob(params: {
  jobId: string;
  sessionId: string;
  body: unknown;
}): Promise<AdminReprocessResult> {
  const request = parseRequestBody(params.body);
  const db = getDb();

  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, params.jobId))
    .limit(1);

  if (!job) {
    throw new AdminReprocessError("Job not found", 404);
  }

  const [sessionRow] = await db
    .select({ hqUserId: schema.sessions.hqUserId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, params.sessionId))
    .limit(1);

  const createdByUserId = sessionRow?.hqUserId ?? null;
  const previousPassKey = job.passKey;
  const current = normalizeExtractionConfig(job.extractionConfigJson);

  let extractionFromLibrary: ExtractionConfig | null = null;
  if (request.parseConfigId) {
    const [parseConfig] = await db
      .select()
      .from(schema.parseConfigs)
      .where(eq(schema.parseConfigs.id, request.parseConfigId))
      .limit(1);
    if (!parseConfig) {
      throw new AdminReprocessError("Parse config not found.", 404);
    }
    extractionFromLibrary = normalizeExtractionConfig(parseConfig.configJson);
    if (!extractionFromLibrary) {
      throw new AdminReprocessError(
        "Selected parse config is not a fps/scene extraction recipe.",
        400,
      );
    }
  }

  const wantsChange =
    request.extraction != null ||
    request.parseConfigId != null ||
    (request.adjustment != null && request.adjustment !== "keep");

  if (wantsChange && current == null && extractionFromLibrary == null && request.extraction == null) {
    throw new AdminReprocessError(
      "This job has no fps/scene extraction config to adjust. Use Keep, or provide an advanced extraction recipe.",
      400,
    );
  }

  const resolved = resolveAdminReprocessExtraction({
    current,
    adjustment: request.adjustment,
    extraction: extractionFromLibrary ?? request.extraction ?? null,
  });

  let campaignId: string | null = null;
  let armId: string | null = null;
  let nextPassKey: string | null = previousPassKey;

  if (resolved.changed) {
    const scoreTarget = job.scoreTarget ?? job.category;
    if (!scoreTarget?.trim()) {
      throw new AdminReprocessError(
        "Job is missing a score target; cannot attribute ad-hoc reprocess experiment.",
        400,
      );
    }

    const passKey = passKeyForExtractionConfig(resolved.config);
    nextPassKey = passKey;

    const configId = await upsertParseConfigForExtraction({
      config: resolved.config,
      passKey,
      createdByUserId,
    });
    campaignId = await ensureAdHocCampaign({
      scoreTarget: scoreTarget.trim(),
      createdByUserId,
    });
    armId = await ensureAdHocArm({
      campaignId,
      configId,
      passKey,
    });

    const groupId = await ensureJobHasGroup(job);
    const now = new Date();

    await db
      .update(schema.videoUploadGroups)
      .set({
        experimentCampaignId: campaignId,
        experimentArmId: armId,
        updatedAt: now,
      })
      .where(eq(schema.videoUploadGroups.id, groupId));

    await db
      .update(schema.videoJobs)
      .set({
        passKey,
        extractionConfigJson: resolved.config,
        groupId,
        updatedAt: now,
      })
      .where(eq(schema.videoJobs.id, job.id));
  }

  await resetVideoJobForReprocess(job.id);

  const adjustmentLabel: AdminReprocessFpsAdjustment | "advanced" =
    resolved.source;

  await writeAuditLog({
    sessionId: params.sessionId,
    action: "video.admin_reprocess",
    resourceType: "video_job",
    resourceName: job.scoreTarget ?? job.category ?? job.id,
    resourceId: job.id,
    metadata: {
      previousPassKey,
      nextPassKey,
      adjustment: adjustmentLabel,
      campaignId,
      armId,
      changed: resolved.changed,
    },
  });

  return {
    jobId: job.id,
    status: "queued",
    previousPassKey,
    nextPassKey,
    changed: resolved.changed,
    campaignId,
    armId,
  };
}
