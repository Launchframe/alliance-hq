import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  trackVideoPipelineFailure,
  trackVideoPipelineTimings,
  type VideoProcessTimings,
} from "@/lib/analytics/video-pipeline";
import { getDb, schema } from "@/lib/db";
import { isValidRosterOcrConfig } from "@/lib/members/roster-ocr/roster-ocr-config";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import { getObject } from "@/lib/storage";
import {
  compareRosterOcrQuality,
  rosterDbRowToCompareRow,
  type RosterTesseractEvalComparison,
} from "@/lib/video/compare-roster-ocr-quality";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { mergeGroupComparisons } from "@/lib/video/group-comparisons.shared";
import { persistOcrEvalSnapshot } from "@/lib/video/ocr-eval-snapshots.server";
import { ocrRosterNativeFrames } from "@/lib/video/ocr-roster-native";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  resolveVideoOcrEngineForJob,
} from "@/lib/video/ocr-provider.shared";

function resolveRosterConfig(job: {
  extractionConfigJson: unknown;
  passKey: string | null;
}): { config: RosterOcrConfig; passKey: string | null } {
  if (isValidRosterOcrConfig(job.extractionConfigJson)) {
    return {
      config: job.extractionConfigJson,
      passKey: job.passKey,
    };
  }
  return {
    config: DEFAULT_ROSTER_OCR_CONFIG,
    passKey: job.passKey,
  };
}

async function loadPrimaryJobFrames(primaryJobId: string) {
  const db = getDb();
  const frameRows = await db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      storageKey: schema.videoFrames.storageKey,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, primaryJobId))
    .orderBy(asc(schema.videoFrames.frameIndex));

  const frames: Array<{ index: number; buffer: Buffer }> = [];
  for (const frame of frameRows) {
    const buffer = await getObject(frame.storageKey);
    frames.push({ index: frame.frameIndex, buffer });
  }
  return frames;
}

async function persistRosterTesseractComparison(params: {
  groupId: string;
  primaryJobId: string;
  shadowJobId: string;
  tessPassKey: string | null;
  shadowTotalMs: number | null;
  experimentCampaignId: string | null;
  experimentArmId: string | null;
  scoreTarget: string | null;
  boardKey: string | null;
  hqEventId: string | null;
}): Promise<void> {
  const db = getDb();

  const [groupRow, primaryJob, shadowJob] = await Promise.all([
    db
      .select({ comparisonJson: schema.videoUploadGroups.comparisonJson })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, params.groupId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ parseSessionId: schema.videoJobs.parseSessionId })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, params.primaryJobId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({ parseSessionId: schema.videoJobs.parseSessionId })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, params.shadowJobId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!primaryJob?.parseSessionId || !shadowJob?.parseSessionId) {
    return;
  }

  const [primaryRows, shadowRows] = await Promise.all([
    db
      .select({
        ocrName: schema.parsedRows.ocrName,
        allianceRank: schema.parsedRows.allianceRank,
        powerLevel: schema.parsedRows.powerLevel,
        memberLevel: schema.parsedRows.memberLevel,
        deleted: schema.parsedRows.deleted,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, primaryJob.parseSessionId)),
    db
      .select({
        ocrName: schema.parsedRows.ocrName,
        allianceRank: schema.parsedRows.allianceRank,
        powerLevel: schema.parsedRows.powerLevel,
        memberLevel: schema.parsedRows.memberLevel,
        deleted: schema.parsedRows.deleted,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, shadowJob.parseSessionId)),
  ]);

  const primaryCompare = primaryRows
    .filter((row) => !row.deleted)
    .map(rosterDbRowToCompareRow);
  const shadowCompare = shadowRows
    .filter((row) => !row.deleted)
    .map(rosterDbRowToCompareRow);

  const metrics = compareRosterOcrQuality(primaryCompare, shadowCompare);
  const comparison: RosterTesseractEvalComparison = {
    kind: "roster_tesseract_eval",
    computedAt: new Date().toISOString(),
    primaryJobId: params.primaryJobId,
    shadowJobId: params.shadowJobId,
    tessPassKey: params.tessPassKey,
    metrics,
    shadowTotalMs: params.shadowTotalMs,
  };

  const primaryEngine = resolveVideoOcrEngineForJob(
    params.scoreTarget ?? "member-roster-video",
    true,
  );

  await persistOcrEvalSnapshot({
    groupId: params.groupId,
    primaryJobId: params.primaryJobId,
    shadowJobId: params.shadowJobId,
    scoreTarget: params.scoreTarget,
    boardKey: params.boardKey,
    hqEventId: params.hqEventId,
    primaryEngine,
    shadowEngine: "native",
    nativePassKey: params.tessPassKey,
    experimentCampaignId: params.experimentCampaignId,
    experimentArmId: params.experimentArmId,
    metrics,
    shadowTotalMs: params.shadowTotalMs,
  });

  await db
    .update(schema.videoUploadGroups)
    .set({
      comparisonJson: mergeGroupComparisons(groupRow?.comparisonJson, {
        roster_tesseract_eval: comparison,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.videoUploadGroups.id, params.groupId));
}

export async function processTesseractShadowRosterJob(
  jobId: string,
  options?: { analyticsSource?: "api" | "worker" },
): Promise<VideoProcessTimings> {
  const timer = new PipelineTimer();
  const db = getDb();

  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (job.passRole !== "tesseract_shadow") {
    throw new Error("Not a Tesseract shadow roster job.");
  }

  if (!job.groupId) {
    throw new Error("Tesseract shadow job is missing groupId.");
  }

  const scoreTargetId = job.scoreTarget ?? job.category ?? "member-roster-video";
  const { config, passKey } = resolveRosterConfig(job);
  const now = new Date();

  const setStatus = async (
    status: string,
    extra: Partial<typeof schema.videoJobs.$inferInsert> = {},
    meta?: { rowCount?: number },
  ) => {
    const updatedAt = new Date();
    await db
      .update(schema.videoJobs)
      .set({ status, updatedAt, ...extra })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status,
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      frameCount: extra.frameCount ?? job.frameCount,
      uploadedFrameCount:
        extra.uploadedFrameCount ?? job.uploadedFrameCount,
      rowCount: meta?.rowCount,
      errorMessage:
        typeof extra.errorMessage === "string"
          ? extra.errorMessage
          : job.errorMessage,
      updatedAt: updatedAt.toISOString(),
    });
  };

  try {
    const [group] = await db
      .select({
        primaryJobId: schema.videoUploadGroups.primaryJobId,
        experimentCampaignId: schema.videoUploadGroups.experimentCampaignId,
        experimentArmId: schema.videoUploadGroups.experimentArmId,
        scoreTarget: schema.videoUploadGroups.scoreTarget,
        boardKey: schema.videoUploadGroups.boardKey,
        hqEventId: schema.videoUploadGroups.hqEventId,
      })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);

    if (!group?.primaryJobId) {
      throw new Error("Upload group has no primary job.");
    }

    const [primaryJob] = await db
      .select({
        allianceId: schema.videoJobs.allianceId,
        parseSessionId: schema.videoJobs.parseSessionId,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, group.primaryJobId))
      .limit(1);

    if (!primaryJob?.parseSessionId) {
      throw new Error("Primary roster job has no parse session.");
    }

    await setStatus("parsing");

    const frames = await timer.measureStep(
      "storage.load_primary_frames",
      () => loadPrimaryJobFrames(group.primaryJobId!),
      (loaded) => ({ frameCount: loaded.length }),
    );

    const nativeResult = await timer.measureStep(
      "tesseract.roster_ocr_total",
      () =>
        ocrRosterNativeFrames(frames, {
          config,
          passKey,
          timer,
          jobId,
        }),
      (result) => ({
        frameCount: result.frameTimings.length,
        rowCount: result.members.length,
      }),
    );

    const extractedRows = nativeResult.members;
    const parseSessionId = nanoid(16);
    const hqAllianceId = primaryJob.allianceId;

    await timer.measureStep("db.create_shadow_parse_session", async () => {
      await db.insert(schema.parseSessions).values({
        id: parseSessionId,
        jobId,
        sessionId: job.sessionId,
        scoreTarget: scoreTargetId,
        allianceId: hqAllianceId,
        rowCount: extractedRows.length,
        matchedCount: 0,
        status: "closed",
        createdAt: now,
        updatedAt: now,
      });
    }, { rowCount: extractedRows.length });

    await timer.measureStep(
      "db.persist_shadow_rows",
      async () => {
        for (const entry of extractedRows) {
          await db.insert(schema.parsedRows).values({
            id: nanoid(16),
            parseSessionId,
            ocrName: entry.currentName,
            score: null,
            rank: null,
            rosterRankRaw: entry.rosterRankRaw,
            allianceRank: entry.allianceRank,
            allianceRankTitle: entry.allianceRankTitle,
            powerLevel: entry.powerLevel,
            memberLevel: entry.memberLevel,
            profession: entry.profession,
            memberId: null,
            memberName: null,
            matchConfidence: null,
            matchMethod: null,
            scoreConflict: 0,
            frameIndex: entry._sourceFrameIndex ?? null,
            deleted: 0,
            edited: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      },
      { rowCount: extractedRows.length },
    );

    const ocrFrameMs = nativeResult.frameTimings.map((frame) => frame.ms);
    const ocrFrameAvgMs =
      ocrFrameMs.length > 0
        ? ocrFrameMs.reduce((sum, ms) => sum + ms, 0) / ocrFrameMs.length
        : null;

    const timings: VideoProcessTimings = {
      jobId,
      scoreTarget: scoreTargetId,
      fileSizeBytes: job.fileSizeBytes,
      frameCount: frames.length,
      rowCount: extractedRows.length,
      matchedCount: 0,
      totalMs: timer.getTotalMs(),
      phases: timer.getPhases(),
      ocrFrameMs,
      ocrFrameAvgMs,
      ocrConcurrency: nativeResult.concurrency,
      ashedUploadTotalMs: null,
      ashedExtractTotalMs: null,
      videoDurationSeconds: null,
      denseFrameCount: null,
      framesSkipped: null,
      totalRawOcrRows: nativeResult.frameTimings.reduce(
        (sum, frame) => sum + frame.entryCount,
        0,
      ),
    };

    await setStatus(
      "complete",
      {
        parseSessionId,
        allianceId: hqAllianceId,
        timingsJson: timings,
        frameCount: frames.length,
        uploadedFrameCount: frames.length,
      },
      { rowCount: extractedRows.length },
    );

    void trackVideoPipelineTimings(timings, {
      jobId,
      scoreTarget: scoreTargetId,
      source: options?.analyticsSource ?? "api",
    });

    try {
      await persistRosterTesseractComparison({
        groupId: job.groupId,
        primaryJobId: group.primaryJobId,
        shadowJobId: jobId,
        tessPassKey: passKey,
        shadowTotalMs: timings.totalMs,
        experimentCampaignId: group.experimentCampaignId,
        experimentArmId: group.experimentArmId,
        scoreTarget: group.scoreTarget ?? scoreTargetId,
        boardKey: group.boardKey,
        hqEventId: group.hqEventId,
      });
    } catch {
      // Comparison failure must not fail shadow job
    }

    return timings;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tesseract shadow processing failed";
    await setStatus("failed", { errorMessage: message });
    timer.log(`tesseract shadow job ${jobId} failed`, { error: message });
    void trackVideoPipelineFailure(
      jobId,
      scoreTargetId,
      message,
      timer.getTotalMs(),
    );
    throw error;
  }
}
