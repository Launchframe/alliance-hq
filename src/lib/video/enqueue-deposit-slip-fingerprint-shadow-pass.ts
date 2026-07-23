/**
 * Enqueue the row-fingerprint shadow pass for deposit-slip video jobs.
 *
 * Mirrors `enqueue-tesseract-shadow-pass.ts` (roster): dispatched as a
 * sibling `video_jobs` row after the primary job reaches "review", fire-and-
 * forget, so it never adds latency to the primary OCR path or blocks the
 * review stage. See `process-deposit-slip-fingerprint-shadow-job.ts` for the
 * shadow processor and `deposit-slip-shadow-comparison.server.ts` for how
 * results are compared against the primary job once *both* the shadow pass
 * has completed and the primary job has been submitted.
 */

import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isBankDepositSlipHistoryTarget } from "@/lib/video/score-targets";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

export const DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_ROLE =
  "deposit_slip_fingerprint_shadow" as const;
export const DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY = "row_fingerprint_v1" as const;

export type DepositSlipFingerprintShadowEligibility = {
  eligible: boolean;
  reason: string;
};

/**
 * Only eligible for deposit-slip primary jobs actually run through native
 * Tesseract. Deposit slips are always native/mock (Ashed has no schema for
 * them — see `isNativeOnlyVideoTarget`), so unlike the roster tesseract
 * shadow pass (which exists to compare against Ashed), this gate is on the
 * *engine*, not on "Ashed is the primary". Mock-engine jobs (synthetic test
 * rows, no real frames) get no benefit from fingerprinting and are excluded
 * so e2e/test jobs don't spend a shadow-processing cycle for nothing.
 */
export function isDepositSlipFingerprintShadowEligible(params: {
  scoreTarget: string | null;
  category: string | null;
  passRole: string | null;
  ocrEngine: string | null;
}): DepositSlipFingerprintShadowEligibility {
  const scoreTargetId = params.scoreTarget ?? params.category;
  if (!scoreTargetId || !isBankDepositSlipHistoryTarget(scoreTargetId)) {
    return { eligible: false, reason: "not_deposit_slip_video" };
  }
  if (params.passRole !== "primary") {
    return { eligible: false, reason: "not_primary" };
  }
  if (params.ocrEngine !== "native") {
    return { eligible: false, reason: "not_native_engine" };
  }
  return { eligible: true, reason: "eligible" };
}

export async function maybeEnqueueDepositSlipFingerprintShadowPass(params: {
  job: {
    id: string;
    sessionId: string;
    processingSessionId?: string | null;
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
  ocrEngine: string | null;
}): Promise<void> {
  const { job } = params;

  const eligibility = isDepositSlipFingerprintShadowEligible({
    scoreTarget: job.scoreTarget,
    category: job.category,
    passRole: job.passRole,
    ocrEngine: params.ocrEngine,
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
        eq(schema.videoJobs.passRole, DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_ROLE),
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
    processingSessionId: job.processingSessionId ?? null,
    allianceId: job.allianceId,
    hqUserId: job.hqUserId,
    scoreTarget: job.scoreTarget ?? job.category,
    category: job.category,
    boardKey: job.boardKey,
    hqEventId: job.hqEventId,
    storageKey: job.storageKey,
    groupId: job.groupId,
    passKey: DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_KEY,
    passIndex: 1,
    passRole: DEPOSIT_SLIP_FINGERPRINT_SHADOW_PASS_ROLE,
    extractionConfigJson: null,
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

  void dispatchVideoProcessing(shadowJobId, {
    source: "deposit_slip_fingerprint_shadow_pass",
  }).catch((err: unknown) => {
    console.error("[deposit-slip-fingerprint-shadow-pass] dispatch failed", err);
  });
}
