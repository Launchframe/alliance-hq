/**
 * Experiment + config assignment for member roster OCR.
 *
 * Mirrors the pattern used by the video pipeline in
 * src/lib/video/experiment-assignment.ts, but scoped to
 * scoreTarget = "member-roster-screenshot".
 *
 * Server-only: imports @/lib/db.
 */

import "server-only";

import { eq } from "drizzle-orm";

import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import {
  DEFAULT_ROSTER_OCR_CONFIG,
  ROSTER_OCR_SCORE_TARGET,
} from "@/lib/members/roster-ocr/types";
import { isValidRosterOcrConfig } from "@/lib/members/roster-ocr/roster-ocr-config";
import { getDb, schema } from "@/lib/db";
import {
  lookupConfigAssignment,
  assignExperiment,
} from "@/lib/video/experiment-assignment";

export type RosterConfigAssignment = {
  config: RosterOcrConfig;
  passKey: string;
  /** Set if this came from an active experiment arm, null if from config assignment or default. */
  experimentCampaignId?: string | null;
  experimentArmId?: string | null;
};

/** Score targets that share roster OCR experiment + parse config assignments. */
export const ROSTER_OCR_EXPERIMENT_SCORE_TARGETS = [
  ROSTER_OCR_SCORE_TARGET,
  MEMBER_ROSTER_VIDEO_SCORE_TARGET,
] as const;

export function isRosterOcrExperimentScoreTarget(scoreTarget: string | null): boolean {
  if (!scoreTarget) return false;
  return (ROSTER_OCR_EXPERIMENT_SCORE_TARGETS as readonly string[]).includes(
    scoreTarget,
  );
}

async function lookupRosterConfigAssignment(): Promise<RosterConfigAssignment | null> {
  for (const scoreTarget of ROSTER_OCR_EXPERIMENT_SCORE_TARGETS) {
    const assignment = await lookupConfigAssignment({
      scoreTarget,
      boardKey: null,
    });
    if (assignment && isValidRosterOcrConfig(assignment.configJson)) {
      return {
        config: assignment.configJson,
        passKey: assignment.passKey,
      };
    }
  }
  return null;
}

/**
 * Load the active parse config for a roster OCR request.
 */
export async function loadRosterOcrConfigAssignment(): Promise<RosterConfigAssignment> {
  const assignment = await lookupRosterConfigAssignment();

  if (assignment) {
    return assignment;
  }

  return {
    config: DEFAULT_ROSTER_OCR_CONFIG,
    passKey: "roster_ocr_scale_2_psm_6",
  };
}

async function assignRosterExperimentForTargets(): Promise<{
  campaignId: string;
  armId: string;
} | null> {
  for (const scoreTarget of ROSTER_OCR_EXPERIMENT_SCORE_TARGETS) {
    const assignment = await assignExperiment({ scoreTarget, boardKey: null });
    if (assignment) return assignment;
  }
  return null;
}

/**
 * Assign an experiment arm for a roster OCR request (if an active campaign exists).
 */
export async function assignRosterOcrExperiment(): Promise<RosterConfigAssignment> {
  const [base, expAssignment] = await Promise.all([
    loadRosterOcrConfigAssignment(),
    assignRosterExperimentForTargets(),
  ]);

  if (!expAssignment) {
    return base;
  }

  return {
    ...base,
    experimentCampaignId: expAssignment.campaignId,
    experimentArmId: expAssignment.armId,
  };
}

async function loadRosterConfigFromArm(
  armId: string,
): Promise<RosterConfigAssignment | null> {
  const db = getDb();
  const [arm] = await db
    .select({
      configId: schema.experimentArms.configId,
      campaignId: schema.experimentArms.campaignId,
    })
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.id, armId))
    .limit(1);

  if (!arm?.configId) {
    return null;
  }

  const [parseConfig] = await db
    .select({
      passKey: schema.parseConfigs.passKey,
      configJson: schema.parseConfigs.configJson,
    })
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, arm.configId))
    .limit(1);

  if (!parseConfig || !isValidRosterOcrConfig(parseConfig.configJson)) {
    return null;
  }

  return {
    config: parseConfig.configJson,
    passKey: parseConfig.passKey,
    experimentCampaignId: arm.campaignId,
    experimentArmId: armId,
  };
}

/**
 * Resolve roster OCR config for a video upload group — prefers the group's
 * experiment arm when it points at a roster-ocr parse config.
 */
export async function resolveRosterOcrConfigForVideoGroup(
  groupId: string,
): Promise<RosterConfigAssignment> {
  const db = getDb();
  const [group] = await db
    .select({
      experimentArmId: schema.videoUploadGroups.experimentArmId,
      experimentCampaignId: schema.videoUploadGroups.experimentCampaignId,
    })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, groupId))
    .limit(1);

  if (group?.experimentArmId) {
    const fromArm = await loadRosterConfigFromArm(group.experimentArmId);
    if (fromArm) {
      return {
        ...fromArm,
        experimentCampaignId:
          fromArm.experimentCampaignId ?? group.experimentCampaignId,
      };
    }

    // Arm without a roster parse config: keep group attribution for eval metrics.
    const base = await loadRosterOcrConfigAssignment();
    return {
      ...base,
      experimentCampaignId: group.experimentCampaignId,
      experimentArmId: group.experimentArmId,
    };
  }

  return assignRosterOcrExperiment();
}
