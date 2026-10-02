import "server-only";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { claimVideoJobForProcessing } from "@/lib/video/claim-video-job-for-processing.server";
import { historyMemberMayProcess } from "@/lib/notes/jobs.server";
import { streamObjectToFile } from "@/lib/storage";
import { getMaxVideoUploadBytes } from "@/lib/video/upload-limit";
import { assertChatVideoTempFile } from "@/lib/video/chat-upload.server";
import { OFFICER_CHAT_VIDEO_TARGET } from "@/lib/video/chat-video.shared";
import { VIDEO_JOB_FAIL_PROTECTED_STATUSES } from "@/lib/video/video-lifecycle.shared";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";

export const CHAT_VIDEO_PARSER_PENDING = "chat_parser_pending" as const;

const imports = schema.knowledgeHistoryImports;
const assets = schema.knowledgeHistoryAssets;

function stubTimings(jobId: string, fileSizeBytes: number | null): VideoProcessTimings {
  return {
    jobId,
    scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
    fileSizeBytes,
    frameCount: 0,
    rowCount: 0,
    matchedCount: 0,
    totalMs: 0,
    phases: {},
    ocrFrameMs: [],
    ocrFrameAvgMs: null,
    ocrConcurrency: 1,
    ashedUploadTotalMs: null,
    ashedExtractTotalMs: null,
    videoDurationSeconds: null,
    denseFrameCount: null,
    framesSkipped: null,
    totalRawOcrRows: null,
  };
}

export async function processChatVideoJobFoundation(
  jobId: string,
): Promise<VideoProcessTimings> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) throw new Error(`Job not found: ${jobId}`);

  const stub = () => stubTimings(jobId, job.fileSizeBytes);
  if (["review", "complete", "submitting"].includes(job.status)) {
    if (
      job.timingsJson &&
      typeof job.timingsJson === "object" &&
      typeof (job.timingsJson as { totalMs?: unknown }).totalMs === "number"
    ) {
      return job.timingsJson as VideoProcessTimings;
    }
    return stub();
  }

  const claim = await claimVideoJobForProcessing(jobId);
  if (claim === "lost_race") return stub();

  const timer = new PipelineTimer();

  const fail = async (message: string, importState: "failed" | "cancelled" = "failed") => {
    const updatedAt = new Date();
    const [failedRow] = await db
      .update(schema.videoJobs)
      .set({ status: "failed", errorMessage: message, updatedAt })
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          notInArray(schema.videoJobs.status, [...VIDEO_JOB_FAIL_PROTECTED_STATUSES]),
        ),
      )
      .returning({ id: schema.videoJobs.id });
    if (job.knowledgeImportId) {
      await db
        .update(imports)
        .set({ state: importState, updatedAt })
        .where(
          and(
            eq(imports.id, job.knowledgeImportId),
            inArray(imports.state, ["uploading", "pending_approval", "processing"]),
          ),
        );
    }
    if (failedRow) {
      await emitVideoJobStatus({
        ...videoJobStatusOwnerFields(job),
        jobId,
        status: "failed",
        fileName: job.fileName,
        scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
        frameCount: null,
        uploadedFrameCount: 0,
        errorMessage: message,
        stage: "failed",
        updatedAt: updatedAt.toISOString(),
      }).catch(() => undefined);
    }
    timer.log(`job ${jobId} chat foundation failed`, { error: message });
  };

  const linkage = await db.transaction(async (tx) => {
    if (!job.knowledgeImportId || !job.allianceId) return null;
    const [record] = await tx
      .select()
      .from(imports)
      .where(and(eq(imports.id, job.knowledgeImportId!), eq(imports.allianceId, job.allianceId!)));
    if (
      !record ||
      record.kind !== "video" ||
      record.sourceVideoJobId !== jobId ||
      (record.state !== "pending_approval" && record.state !== "processing")
    ) {
      return null;
    }
    const [resource] = await tx
      .select()
      .from(schema.knowledgeResources)
      .where(
        and(
          eq(schema.knowledgeResources.id, record.resourceId),
          eq(schema.knowledgeResources.allianceId, record.allianceId),
        ),
      );
    if (
      !resource ||
      resource.archivedAt ||
      resource.ownershipState !== "hq" ||
      !resource.ownerHqUserId ||
      job.hqUserId !== resource.ownerHqUserId ||
      job.enqueuedByHqUserId !== resource.ownerHqUserId
    ) {
      return null;
    }
    const member = await historyMemberMayProcess(tx, {
      allianceId: record.allianceId,
      ownerHqUserId: resource.ownerHqUserId,
    });
    if (!member) return null;
    const [asset] = await tx
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.importId, record.id),
          eq(assets.allianceId, record.allianceId),
          eq(assets.stagingKey, job.storageKey ?? ""),
        ),
      )
      .limit(1);
    if (!asset || !asset.sealedKey) return null;
    return { record, asset };
  });

  if (!linkage) {
    await fail("chat_link_invalid");
    throw new Error(`Chat video job ${jobId} lost import linkage or owner authority`);
  }
  const { record, asset } = linkage;

  const [claimed] = await db
    .update(imports)
    .set({ state: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(imports.id, record.id),
        eq(imports.sourceVideoJobId, jobId),
        inArray(imports.state, ["pending_approval", "processing"]),
      ),
    )
    .returning({ id: imports.id });
  if (!claimed) {
    await fail("chat_link_invalid");
    throw new Error(`Chat video job ${jobId} lost import linkage or owner authority`);
  }

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "extracting",
    fileName: job.fileName,
    scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
    stage: "extracting_frames",
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined);

  let durationSeconds: number;
  const tmpPath = path.join(
    os.tmpdir(),
    `hq-chat-video-${jobId}${path.extname(job.fileName ?? ".mp4")}`,
  );
  try {
    await timer.measureStep("storage.load_video", () =>
      streamObjectToFile(asset.sealedKey!, tmpPath, getMaxVideoUploadBytes()),
    (bytes) => ({ bytes }));
    const probed = await timer.measureStep("ffmpeg.probe", () =>
      assertChatVideoTempFile(tmpPath, asset.contentType),
    );
    durationSeconds = probed.durationSeconds;
  } catch (error) {
    await fail(error instanceof Error ? error.message : "chat_video_invalid");
    throw error;
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }

  const timings: VideoProcessTimings = {
    ...stub(),
    totalMs: timer.getTotalMs(),
    phases: timer.getPhases(),
    videoDurationSeconds: durationSeconds,
  };

  const updatedAt = new Date();
  try {
    await db.transaction(async (tx) => {
      const [parkedJob] = await tx
        .update(schema.videoJobs)
        .set({
          status: "review",
          errorMessage: CHAT_VIDEO_PARSER_PENDING,
          timingsJson: timings,
          updatedAt,
        })
        .where(
          and(
            eq(schema.videoJobs.id, jobId),
            notInArray(schema.videoJobs.status, [...VIDEO_JOB_FAIL_PROTECTED_STATUSES]),
          ),
        )
        .returning({ id: schema.videoJobs.id });
      const [parkedImport] = await tx
        .update(imports)
        .set({ state: "review", updatedAt })
        .where(
          and(
            eq(imports.id, record.id),
            eq(imports.state, "processing"),
            eq(imports.sourceVideoJobId, jobId),
          ),
        )
        .returning({ id: imports.id });
      if (!parkedJob || !parkedImport) throw new Error("chat_finalize_lost");
    });
  } catch (error) {
    if (!(error instanceof Error && error.message === "chat_finalize_lost")) throw error;
    await fail("chat_finalize_lost");
    throw new Error(`Chat video job ${jobId} lost linkage during checkpoint`);
  }

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "review",
    fileName: job.fileName,
    scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
    frameCount: 0,
    uploadedFrameCount: 0,
    errorMessage: CHAT_VIDEO_PARSER_PENDING,
    updatedAt: updatedAt.toISOString(),
  }).catch(() => undefined);

  await writeAuditLog({
    sessionId: job.sessionId,
    allianceId: job.allianceId,
    action: "video.parse_complete",
    resourceType: "video_job",
    resourceName: OFFICER_CHAT_VIDEO_TARGET,
    resourceId: jobId,
    metadata: {
      importId: record.id,
      fileName: job.fileName,
      bytes: job.fileSizeBytes,
      durationSeconds,
      parserPending: true,
    },
  });

  timer.log(`job ${jobId} chat foundation checkpoint`, { durationSeconds });
  return timings;
}
