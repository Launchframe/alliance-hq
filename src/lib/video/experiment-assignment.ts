import { and, asc, eq, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_PRIMARY_PASS,
  type ExtractionConfig,
} from "@/lib/video/pass-definitions";

/** Frame-extraction configs only (scene/fps) — not roster-ocr knobs. */
export function isFrameExtractionConfig(
  value: unknown,
): value is ExtractionConfig {
  if (!value || typeof value !== "object") return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "scene" || mode === "fps";
}

export type PrimaryExtractionStamp = {
  passKey: string;
  configJson: ExtractionConfig;
  experimentCampaignId: string | null;
  experimentArmId: string | null;
};

/**
 * Pure resolver: standing assignment/default vs active experiment arm.
 * Variant arms with a frame-extraction parse config override the primary.
 * Control arms (configId null) and roster-ocr configs keep the standing default.
 */
export function resolvePrimaryExtractionStamp(params: {
  standing: { passKey: string; configJson: ExtractionConfig } | null;
  experiment: {
    campaignId: string;
    armId: string;
    configId: string | null;
    armConfig: { passKey: string; configJson: unknown } | null;
  } | null;
}): PrimaryExtractionStamp {
  const standingPassKey = params.standing?.passKey ?? "scene_0.25";
  const standingConfig = params.standing?.configJson ?? DEFAULT_PRIMARY_PASS;

  if (!params.experiment) {
    return {
      passKey: standingPassKey,
      configJson: standingConfig,
      experimentCampaignId: null,
      experimentArmId: null,
    };
  }

  const armExtraction =
    params.experiment.armConfig &&
    isFrameExtractionConfig(params.experiment.armConfig.configJson)
      ? {
          passKey: params.experiment.armConfig.passKey,
          configJson: params.experiment.armConfig.configJson,
        }
      : null;

  // Variant with scene/fps config → stamp onto primary. Control / roster-ocr → standing.
  if (params.experiment.configId && armExtraction) {
    return {
      passKey: armExtraction.passKey,
      configJson: armExtraction.configJson,
      experimentCampaignId: params.experiment.campaignId,
      experimentArmId: params.experiment.armId,
    };
  }

  return {
    passKey: standingPassKey,
    configJson: standingConfig,
    experimentCampaignId: params.experiment.campaignId,
    experimentArmId: params.experiment.armId,
  };
}

export type ExperimentAssignmentCampaign = {
  id: string;
  boardKey: string | null;
  createdAt: Date;
  trafficPercent: number;
};

export type ExperimentAssignmentArm = {
  id: string;
  trafficWeight: number;
};

export function pickExperimentCampaign(
  campaigns: ExperimentAssignmentCampaign[],
  boardKey: string | null,
): ExperimentAssignmentCampaign | null {
  const matchingCampaigns = boardKey
    ? campaigns.filter((campaign) => campaign.boardKey === boardKey)
    : campaigns.filter((campaign) => campaign.boardKey === null);
  const fallbackCampaigns = campaigns.filter((campaign) => campaign.boardKey === null);

  const candidates =
    matchingCampaigns.length > 0 ? matchingCampaigns : fallbackCampaigns;

  return (
    [...candidates].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )[0] ?? null
  );
}

export function pickExperimentArm(
  arms: ExperimentAssignmentArm[],
  randomValue: number,
): ExperimentAssignmentArm | null {
  const eligibleArms = arms.filter((arm) => arm.trafficWeight > 0);
  const totalWeight = eligibleArms.reduce(
    (sum, arm) => sum + arm.trafficWeight,
    0,
  );
  if (totalWeight <= 0) {
    return null;
  }

  let roll = randomValue * totalWeight;
  let chosenArm = eligibleArms[eligibleArms.length - 1];
  for (const arm of eligibleArms) {
    roll -= arm.trafficWeight;
    if (roll <= 0) {
      chosenArm = arm;
      break;
    }
  }

  return chosenArm;
}

/**
 * Given a new upload's scoreTarget + boardKey, find the active campaign
 * matching that scope and probabilistically assign the group to an arm.
 * Returns { campaignId, armId } if assigned, null if no active campaign
 * or the random roll misses trafficPercent.
 *
 * Arm parse configs are applied to the **primary** job via
 * `resolvePrimaryExtractionForUpload` — not via shadow enqueue.
 */
export async function assignExperiment(params: {
  scoreTarget: string | null;
  boardKey: string | null;
}): Promise<{ campaignId: string; armId: string } | null> {
  if (!params.scoreTarget) {
    return null;
  }

  const db = getDb();

  // Fetch eligible campaigns and pick specificity in TypeScript so Postgres
  // NULL ordering cannot make a global campaign beat a board-specific one.
  const campaigns = await db
    .select()
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

  const campaign = pickExperimentCampaign(campaigns, params.boardKey);
  if (!campaign) {
    return null;
  }

  // Traffic percent gate
  if (Math.random() * 100 >= campaign.trafficPercent) {
    return null;
  }

  const arms = await db
    .select()
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.campaignId, campaign.id));

  if (arms.length === 0) {
    return null;
  }

  const chosenArm = pickExperimentArm(arms, Math.random());
  if (!chosenArm) return null;

  return { campaignId: campaign.id, armId: chosenArm.id };
}

/**
 * Look up the most-specific configAssignment for a (scoreTarget, boardKey)
 * combination: scoreTarget+boardKey first, then scoreTarget+null, then
 * global (both null). Returns { passKey, configJson } if found, null otherwise.
 */
export async function lookupConfigAssignment(params: {
  scoreTarget: string | null;
  boardKey: string | null;
}): Promise<{ passKey: string; configJson: ExtractionConfig } | null> {
  const db = getDb();

  const assignments = await db
    .select({
      scoreTarget: schema.configAssignments.scoreTarget,
      boardKey: schema.configAssignments.boardKey,
      configId: schema.configAssignments.configId,
    })
    .from(schema.configAssignments);

  // Most-specific first: exact match, then scoreTarget+null, then global
  const exactMatch = assignments.find(
    (a) => a.scoreTarget === params.scoreTarget && a.boardKey === params.boardKey,
  );
  const scoreOnlyMatch = assignments.find(
    (a) => a.scoreTarget === params.scoreTarget && a.boardKey === null,
  );
  const globalMatch = assignments.find(
    (a) => a.scoreTarget === null && a.boardKey === null,
  );

  const match = exactMatch ?? scoreOnlyMatch ?? globalMatch;
  if (!match) {
    return null;
  }

  const [config] = await db
    .select({
      passKey: schema.parseConfigs.passKey,
      configJson: schema.parseConfigs.configJson,
    })
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, match.configId))
    .limit(1);

  if (!config) {
    return null;
  }

  return {
    passKey: config.passKey,
    configJson: config.configJson as ExtractionConfig,
  };
}

/**
 * Resolve the primary job's extraction config for a new upload.
 * Active experiment arms drive primary A/B; standing config_assignments are
 * the control / post-campaign default. Roster-ocr arm configs are ignored for
 * frame extraction (those apply via the roster OCR / Tesseract shadow path).
 */
export async function resolvePrimaryExtractionForUpload(params: {
  scoreTarget: string | null;
  boardKey: string | null;
}): Promise<PrimaryExtractionStamp> {
  const [standing, expAssignment] = await Promise.all([
    lookupConfigAssignment({
      scoreTarget: params.scoreTarget,
      boardKey: params.boardKey,
    }),
    assignExperiment({
      scoreTarget: params.scoreTarget,
      boardKey: params.boardKey,
    }),
  ]);

  if (!expAssignment) {
    return resolvePrimaryExtractionStamp({
      standing,
      experiment: null,
    });
  }

  const db = getDb();
  const [arm] = await db
    .select({
      configId: schema.experimentArms.configId,
    })
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.id, expAssignment.armId))
    .limit(1);

  let armConfig: { passKey: string; configJson: unknown } | null = null;
  if (arm?.configId) {
    const [parseConfig] = await db
      .select({
        passKey: schema.parseConfigs.passKey,
        configJson: schema.parseConfigs.configJson,
      })
      .from(schema.parseConfigs)
      .where(eq(schema.parseConfigs.id, arm.configId))
      .limit(1);
    if (parseConfig) {
      armConfig = {
        passKey: parseConfig.passKey,
        configJson: parseConfig.configJson,
      };
    }
  }

  return resolvePrimaryExtractionStamp({
    standing,
    experiment: {
      campaignId: expAssignment.campaignId,
      armId: expAssignment.armId,
      configId: arm?.configId ?? null,
      armConfig,
    },
  });
}
