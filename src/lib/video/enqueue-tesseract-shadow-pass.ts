import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";

import { assignRosterOcrExperiment } from "@/lib/members/roster-ocr/assign-roster-config";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { getDb, schema } from "@/lib/db";
import { isMemberRosterVideoTarget } from "@/lib/video/score-targets";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

export type TesseractShadowEligibility = {
  eligible: boolean;
  reason: string;
};

export function isTesseractShadowEligible(params: {
  scoreTarget: string | null;
  category: string | null;
  passRole: string | null;
}): TesseractShadowEligibility {
  const scoreTargetId = params.scoreTarget ?? params.category;
  if (!scoreTargetId || !isMemberRosterVideoTarget(scoreTargetId)) {
    return { eligible: false, reason: "not_roster_video" };
  }
  if (params.passRole !== "primary") {
    return { eligible: false, reason: "not_primary" };
  }
  return { eligible: true, reason: "eligible" };
}

export async function maybeEnqueueTesseractShadowPass(params: {
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
}): Promise<void> {
  const { job } = params;

  const eligibility = isTesseractShadowEligible({
    scoreTarget: job.scoreTarget,
    category: job.category,
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
        eq(schema.videoJobs.passRole, "tesseract_shadow"),
      ),
    )
    .limit(1);

  if (existing) {
    return;
  }

  const rosterAssignment = await assignRosterOcrExperiment();
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
    passKey: rosterAssignment.passKey,
    passIndex: 1,
    passRole: "tesseract_shadow",
    extractionConfigJson: rosterAssignment.config as RosterOcrConfig,
    status: "queued",
    fileName: null,
    fileSizeBytes: null,
    frameCount: job.frameCount,
    uploadedFrameCount: job.frameCount,
    parseSessionId: null,
    errorMessage: null,
    timingsJson: null,
    totalFileSizeBytes: null,
    ingestMethod: "video",
    createdAt: now,
    updatedAt: now,
  });

  void dispatchVideoProcessing(shadowJobId, { source: "tesseract_shadow_pass" }).catch(
    (err: unknown) => {
      console.error("[tesseract-shadow-pass] dispatch failed", err);
    },
  );
}
