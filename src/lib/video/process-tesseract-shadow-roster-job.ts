import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  trackVideoPipelineFailure,
  trackVideoPipelineTimings,
  type VideoProcessTimings,
} from "@/lib/analytics/video-pipeline";
import { getDb, schema } from "@/lib/db";
import { parseRosterImage } from "@/lib/members/roster-ocr/parse-roster-image";
import type { ParsedRosterRow, RosterOcrConfig } from "@/lib/members/roster-ocr/types";
import { DEFAULT_ROSTER_OCR_CONFIG } from "@/lib/members/roster-ocr/types";
import { isValidRosterOcrConfig } from "@/lib/members/roster-ocr/roster-ocr-config";
import { getObject } from "@/lib/storage";
import {
  compareRosterOcrQuality,
  rosterDbRowToCompareRow,
  type RosterTesseractEvalComparison,
} from "@/lib/video/compare-roster-ocr-quality";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import {
  collapseRosterMembersByNameRank,
  type ExtractedRosterMember,
} from "@/lib/video/roster-extract";

const TESSERACT_FRAME_CONCURRENCY = 2;

function parsedRosterRowToExtracted(
  row: ParsedRosterRow,
  sourceFrameIndex?: number,
): ExtractedRosterMember {
  return {
    currentName: row.extractedName.trim(),
    rosterRankRaw: `R${row.allianceRank}`,
    allianceRank: row.allianceRank,
    allianceRankTitle: null,
    powerLevel: row.heroPowerM != null ? `${row.heroPowerM}M` : null,
    heroPowerM: row.heroPowerM ?? null,
    memberLevel: row.memberLevel ?? null,
    profession: null,
    status: null,
    _sourceFrameIndex: sourceFrameIndex,
  };
}

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
}): Promise<void> {
  const db = getDb();

  const [primaryJob, shadowJob] = await Promise.all([
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

  await db
    .update(schema.videoUploadGroups)
    .set({ comparisonJson: comparison, updatedAt: new Date() })
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
      sessionId: job.sessionId,
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
      .select({ primaryJobId: schema.videoUploadGroups.primaryJobId })
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

    const frameResults = await timer.measureStep(
      "tesseract.roster_ocr_total",
      () =>
        mapWithConcurrency(frames, TESSERACT_FRAME_CONCURRENCY, async (frame) => {
          const started = Date.now();
          try {
            const result = await parseRosterImage(frame.buffer, {
              config,
              configPassKey: passKey ?? undefined,
            });
            return {
              frameIndex: frame.index,
              ms: Date.now() - started,
              rows: result.rows,
              error: null as string | null,
            };
          } catch (error) {
            return {
              frameIndex: frame.index,
              ms: Date.now() - started,
              rows: [] as ParsedRosterRow[],
              error:
                error instanceof Error ? error.message : "Tesseract OCR failed",
            };
          }
        }),
      (results) => ({
        frameCount: results.length,
        rowCount: results.reduce((sum, frame) => sum + frame.rows.length, 0),
      }),
    );

    const extractedRows = collapseRosterMembersByNameRank(
      frameResults.flatMap((frame) =>
        frame.rows.map((row) => parsedRosterRowToExtracted(row, frame.frameIndex)),
      ),
    );

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

    const ocrFrameMs = frameResults.map((frame) => frame.ms);
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
      ocrConcurrency: TESSERACT_FRAME_CONCURRENCY,
      ashedUploadTotalMs: null,
      ashedExtractTotalMs: null,
      videoDurationSeconds: null,
      denseFrameCount: null,
      framesSkipped: null,
      totalRawOcrRows: frameResults.reduce(
        (sum, frame) => sum + frame.rows.length,
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
