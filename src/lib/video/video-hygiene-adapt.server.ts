import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { passKeyForExtractionConfig } from "@/lib/video/admin-reprocess-extraction.shared";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import {
  applyDenseAdaptOverlay,
  shouldApplyDenseAdaptBias,
} from "@/lib/video/video-hygiene-adapt.shared";
import {
  loadUploaderScoreTargetRewards,
  recordVideoHygieneEvent,
} from "@/lib/video/video-hygiene-instrumentation.server";

export type AdaptOverlayResult = {
  configJson: ExtractionConfig;
  passKey: string;
  biasOn: boolean;
  overlayApplied: boolean;
};

/**
 * Resolve primary extraction with an optional per-uploader denser overlay.
 * Emits adapt_* events only on state / arm transitions.
 */
export async function resolveAdaptedPrimaryExtraction(params: {
  hqUserId: string | null;
  scoreTarget: string;
  allianceId: string | null;
  jobId: string;
  primary: { passKey: string; configJson: ExtractionConfig };
  days?: number;
}): Promise<AdaptOverlayResult> {
  if (!params.hqUserId) {
    return {
      configJson: params.primary.configJson,
      passKey: params.primary.passKey,
      biasOn: false,
      overlayApplied: false,
    };
  }

  const previouslyOn = await loadAdaptBiasOn(
    params.hqUserId,
    params.scoreTarget,
  );
  const rewards = await loadUploaderScoreTargetRewards({
    days: params.days ?? 60,
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
  });
  const row = rewards.find(
    (r) =>
      r.hqUserId === params.hqUserId && r.scoreTarget === params.scoreTarget,
  );

  const biasOn = shouldApplyDenseAdaptBias({
    jobCount: row?.jobCount ?? 0,
    thumbsUpRate: row?.thumbsUpRate ?? null,
    avgQualityScore: row?.avgQualityScore ?? null,
    scrollStyleCounts: row?.scrollStyleCounts ?? {},
    previouslyOn,
  });

  let configJson = params.primary.configJson;
  let passKey = params.primary.passKey;
  let overlayApplied = false;

  if (biasOn) {
    const overlay = applyDenseAdaptOverlay(params.primary.configJson);
    if (overlay.changed) {
      configJson = overlay.config;
      passKey = overlay.passKey;
      overlayApplied = true;
    } else {
      passKey = passKeyForExtractionConfig(configJson);
    }
  }

  await maybeRecordAdaptTransitions({
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    allianceId: params.allianceId,
    jobId: params.jobId,
    previouslyOn,
    biasOn,
    overlayApplied,
    fromPassKey: params.primary.passKey,
    toPassKey: passKey,
  });

  return { configJson, passKey, biasOn, overlayApplied };
}

async function loadAdaptBiasOn(
  hqUserId: string,
  scoreTarget: string,
): Promise<boolean> {
  const db = getDb();
  const [latest] = await db
    .select({ kind: schema.videoHygieneEvents.kind })
    .from(schema.videoHygieneEvents)
    .where(
      and(
        eq(schema.videoHygieneEvents.hqUserId, hqUserId),
        eq(schema.videoHygieneEvents.scoreTarget, scoreTarget),
        inArray(schema.videoHygieneEvents.kind, [
          "adapt_bias_on",
          "adapt_bias_off",
        ]),
      ),
    )
    .orderBy(desc(schema.videoHygieneEvents.createdAt))
    .limit(1);

  return latest?.kind === "adapt_bias_on";
}

async function maybeRecordAdaptTransitions(params: {
  hqUserId: string;
  scoreTarget: string;
  allianceId: string | null;
  jobId: string;
  previouslyOn: boolean;
  biasOn: boolean;
  overlayApplied: boolean;
  fromPassKey: string;
  toPassKey: string;
}): Promise<void> {
  const base = {
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    allianceId: params.allianceId,
    jobId: params.jobId,
  };

  if (!params.previouslyOn && params.biasOn) {
    await recordVideoHygieneEvent({
      ...base,
      kind: "adapt_bias_on",
      payload: {
        fromPassKey: params.fromPassKey,
        toPassKey: params.toPassKey,
        overlayApplied: params.overlayApplied,
      },
    });
  } else if (params.previouslyOn && !params.biasOn) {
    await recordVideoHygieneEvent({
      ...base,
      kind: "adapt_bias_off",
      payload: {
        fromPassKey: params.fromPassKey,
        toPassKey: params.toPassKey,
      },
    });
  }

  if (
    params.biasOn &&
    params.overlayApplied &&
    params.fromPassKey !== params.toPassKey
  ) {
    // Always log arm change when overlay mutates the primary pass key
    // (including first bias-on).
    await recordVideoHygieneEvent({
      ...base,
      kind: "adapt_arm_change",
      payload: {
        fromPassKey: params.fromPassKey,
        toPassKey: params.toPassKey,
      },
    });
  }
}
