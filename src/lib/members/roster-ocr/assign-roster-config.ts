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

import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import {
  DEFAULT_ROSTER_OCR_CONFIG,
  ROSTER_OCR_SCORE_TARGET,
} from "@/lib/members/roster-ocr/types";
import { isValidRosterOcrConfig } from "@/lib/members/roster-ocr/roster-ocr-config";
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

/**
 * Load the active parse config for a roster OCR request.
 *
 * Resolution order (mirrors video pipeline):
 *  1. Active config assignment for scoreTarget="member-roster-screenshot" + boardKey=null.
 *  2. If the configJson is not a valid RosterOcrConfig, fall back to defaults.
 *  3. Returns defaults if no assignment exists.
 */
export async function loadRosterOcrConfigAssignment(): Promise<RosterConfigAssignment> {
  const assignment = await lookupConfigAssignment({
    scoreTarget: ROSTER_OCR_SCORE_TARGET,
    boardKey: null,
  });

  if (assignment && isValidRosterOcrConfig(assignment.configJson)) {
    return {
      config: assignment.configJson,
      passKey: assignment.passKey,
    };
  }

  return {
    config: DEFAULT_ROSTER_OCR_CONFIG,
    passKey: "roster_ocr_scale_2_psm_6",
  };
}

/**
 * Assign an experiment arm for a roster OCR request (if an active campaign exists).
 *
 * Returns { campaignId, armId, config, passKey } if assigned, or the base
 * config assignment if no experiment is active.
 */
export async function assignRosterOcrExperiment(): Promise<RosterConfigAssignment> {
  const [base, expAssignment] = await Promise.all([
    loadRosterOcrConfigAssignment(),
    assignExperiment({ scoreTarget: ROSTER_OCR_SCORE_TARGET, boardKey: null }),
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
