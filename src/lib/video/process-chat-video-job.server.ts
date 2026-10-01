import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { claimVideoJobForProcessing } from "@/lib/video/claim-video-job-for-processing.server";
import { historyMemberMayProcess } from "@/lib/notes/jobs.server";
import { touchKnowledgeResource } from "@/lib/notes/resources.server";
import { deleteObject, streamObjectToFile } from "@/lib/storage";
import { getMaxVideoUploadBytes } from "@/lib/video/upload-limit";
import { assertChatVideoTempFile } from "@/lib/video/chat-upload.server";
import { OFFICER_CHAT_VIDEO_TARGET } from "@/lib/video/chat-video.shared";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import { mapWithConcurrency } from "@/lib/video/map-with-concurrency";
import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { extractChatVideoFrames } from "@/lib/video/chat-frames.server";
import {
  CHAT_PARSER_CONFIG_VERSION,
  stitchChatFrames,
  type ParsedChatFrame,
} from "@/lib/video/chat-parser.shared";
import {
  CHAT_PARSER_NOT_CONFIGURED,
  chatParserProvenance,
  resolveChatFrameParser,
} from "@/lib/video/chat-vision.server";
import {
  buildChatMediaArtifacts,
  CHAT_MEDIA_MAX_OBSERVATIONS,
  dedupeMediaArtifacts,
  uploadChatMediaArtifacts,
} from "@/lib/video/chat-media.server";
import { HISTORY_MESSAGE_LIMIT } from "@/lib/notes/imports.shared";
import { resolveOfficerChatLocaleText } from "@/lib/officer-intel/locale-text.server";

const imports = schema.knowledgeHistoryImports;
const assets = schema.knowledgeHistoryAssets;
const messages = schema.officerChatMessages;
const media = schema.officerChatMessageMedia;
const PARSE_CONCURRENCY = 2;

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
    ocrConcurrency: PARSE_CONCURRENCY,
    ashedUploadTotalMs: null,
    ashedExtractTotalMs: null,
    videoDurationSeconds: null,
    denseFrameCount: null,
    framesSkipped: null,
    totalRawOcrRows: null,
  };
}

function stableErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === CHAT_PARSER_NOT_CONFIGURED || message === "chat_finalize_lost" || message === "chat_no_content" || message === "chat_import_limit") {
    return message;
  }
  return "chat_parse_failed";
}

export async function processChatVideoJob(
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
          eq(schema.videoJobs.status, "extracting"),
        ),
      )
      .returning({ id: schema.videoJobs.id });
    if (failedRow && job.knowledgeImportId) {
      await db
        .update(imports)
        .set({ state: importState, updatedAt })
        .where(
          and(
            eq(imports.id, job.knowledgeImportId),
            eq(imports.sourceVideoJobId, jobId),
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
    timer.log(`job ${jobId} chat parse failed`, { error: message });
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

  const tmpPath = path.join(
    os.tmpdir(),
    `hq-chat-video-${jobId}${path.extname(job.fileName ?? ".mp4")}`,
  );
  let createdKeys: string[] = [];
  let failedAlready = false;
  const failOnce = async (message: string) => {
    if (failedAlready) return;
    failedAlready = true;
    await fail(message);
  };
  try {
    let durationSeconds: number;
    try {
      await timer.measureStep("storage.load_video", () =>
        streamObjectToFile(asset.sealedKey!, tmpPath, getMaxVideoUploadBytes()),
      (bytes) => ({ bytes }));
      const probed = await timer.measureStep("ffmpeg.probe", () =>
        assertChatVideoTempFile(tmpPath, asset.contentType),
      );
      durationSeconds = probed.durationSeconds;
    } catch (error) {
      await failOnce("chat_video_invalid");
      throw error;
    }

    const { frames, videoDurationSeconds } = await timer.measureStep(
      "ffmpeg.extract_frames",
      () => extractChatVideoFrames(tmpPath),
    );
    if (videoDurationSeconds != null) durationSeconds = videoDurationSeconds;
    if (!frames.length) {
      await failOnce("chat_no_content");
      throw new Error("chat_no_content");
    }

    const { parse, model } = resolveChatFrameParser();
    const parsedFrames: ParsedChatFrame[] = await mapWithConcurrency(frames, PARSE_CONCURRENCY, async (frame) => {
      const output = await timer.measureStep(
        "chat.frame_parse",
        () => parse({ png: frame.png, frameIndex: frame.frameIndex, frameHash: frame.frameHash }),
      );
      return {
        frameIndex: frame.frameIndex,
        timestampMs: frame.timestampMs,
        frameHash: frame.frameHash,
        sharpness: frame.sharpness,
        messages: output.messages,
        media: output.media,
      };
    });

    const stitched = stitchChatFrames(parsedFrames);
    const mediaLinkedIndexes = new Set(
      stitched.media
        .map((item) => item.messageIndex)
        .filter((index): index is number => index != null),
    );
    const keptIndexByOld = new Map<number, number>();
    stitched.messages = stitched.messages.filter((message, index) => {
      const keep = message.originalText.trim().length > 0 || mediaLinkedIndexes.has(index);
      if (keep) keptIndexByOld.set(index, keptIndexByOld.size);
      return keep;
    });
    for (const item of stitched.media) {
      item.messageIndex =
        item.messageIndex != null ? (keptIndexByOld.get(item.messageIndex) ?? null) : null;
    }
    if (stitched.messages.length > HISTORY_MESSAGE_LIMIT || stitched.media.length > CHAT_MEDIA_MAX_OBSERVATIONS) {
      await failOnce("chat_import_limit");
      throw new Error("chat_import_limit");
    }
    for (const message of stitched.messages) {
      message.replyToIndex =
        message.replyToIndex != null ? (keptIndexByOld.get(message.replyToIndex) ?? null) : null;
      if (message.replyToIndex == null) message.replyMatchConfidence = null;
    }
    if (!stitched.messages.length && !stitched.media.length) {
      await failOnce("chat_no_content");
      throw new Error("chat_no_content");
    }

    const englishTexts = await mapWithConcurrency(stitched.messages, PARSE_CONCURRENCY, async (message) => {
      if (!message.originalText.trim()) return null;
      const translated = await resolveOfficerChatLocaleText({
        allianceId: record.allianceId,
        originalText: message.originalText,
        hqLocale: "en-US",
      });
      if (translated.translationUnavailable) message.reviewReasons.push("translation_unavailable");
      return translated.localeText;
    });

    const artifacts = dedupeMediaArtifacts(
      await buildChatMediaArtifacts(stitched.media, frames, record.id),
    );
    if (!stitched.messages.length && !artifacts.length) {
      await failOnce("chat_no_content");
      throw new Error("chat_no_content");
    }
    createdKeys = await uploadChatMediaArtifacts(artifacts);

    const timings: VideoProcessTimings = {
      ...stub(),
      totalMs: timer.getTotalMs(),
      phases: timer.getPhases(),
      frameCount: frames.length,
      rowCount: stitched.messages.length,
      videoDurationSeconds: durationSeconds,
    };

    const updatedAt = new Date();
    const messageIds = stitched.messages.map(() => nanoid());
    try {
      await db.transaction(async (tx) => {
        const [existingMessage] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.sessionId, record.id), eq(messages.allianceId, record.allianceId)))
          .limit(1);
        const [existingMedia] = await tx
          .select({ id: media.id })
          .from(media)
          .where(and(eq(media.sessionId, record.id), eq(media.allianceId, record.allianceId)))
          .limit(1);
        if (existingMessage || existingMedia) throw new Error("chat_finalize_lost");

        if (stitched.messages.length) {
          await tx.insert(messages).values(
            stitched.messages.map((message, index) => ({
              id: messageIds[index]!,
              sessionId: record.id,
              allianceId: record.allianceId,
              senderName: message.sender,
              originalText: message.originalText,
              localeText: englishTexts[index] ?? message.originalText,
              localeCode: "en-US",
              isReply: message.isReply,
              replyToName: message.replyToName,
              replyToMessageId: message.replyToIndex != null ? messageIds[message.replyToIndex]! : null,
              replyMatchConfidence: message.replyMatchConfidence,
              coordinates: message.coordinates,
              extractionConfidence: message.confidence,
              reviewReasons: message.reviewReasons,
              parserProvenance: chatParserProvenance(model, message.frameHash),
              sequenceOrder: index,
              sourceImageIndex: message.observationFrameIndex,
              sourceLocator: `chat-video:${message.observationFrameIndex}:${message.timestampMs ?? 0}:${message.localId}`,
              historyIncluded: true,
              historyReviewed: false,
              sentAt: null,
            })),
          );
        }
        if (artifacts.length) {
          await tx.insert(media).values(
            artifacts.map((artifact, index) => ({
              id: artifact.mediaId,
              sessionId: record.id,
              allianceId: record.allianceId,
              messageId:
                artifact.media.messageIndex != null ? messageIds[artifact.media.messageIndex]! : null,
              kind: artifact.media.kind,
              storageKey: artifact.storageKey,
              thumbnailStorageKey: artifact.thumbnailStorageKey,
              contentType: artifact.contentType,
              sha256: artifact.sha256,
              width: artifact.width,
              height: artifact.height,
              sourceFrameIndex: artifact.media.sourceFrameIndex,
              sourceTimestampMs: artifact.media.sourceTimestampMs,
              sequenceOrder: index,
              reviewed: false,
            })),
          );
        }
        await touchKnowledgeResource(tx, record.resourceId);

        const [parkedJob] = await tx
          .update(schema.videoJobs)
          .set({
            status: "review",
            errorMessage: null,
            timingsJson: timings,
            updatedAt,
          })
          .where(
            and(
              eq(schema.videoJobs.id, jobId),
              eq(schema.videoJobs.status, "extracting"),
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
      createdKeys = [];
    } catch (error) {
      await Promise.all(createdKeys.map((key) => deleteObject(key).catch(() => undefined)));
      createdKeys = [];
      if (error instanceof Error && error.message === "chat_finalize_lost") {
        await failOnce("chat_finalize_lost");
        throw new Error(`Chat video job ${jobId} lost linkage during checkpoint`);
      }
      const code = stableErrorCode(error);
      await failOnce(code);
      throw error;
    }

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "review",
      fileName: job.fileName,
      scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
      frameCount: frames.length,
      uploadedFrameCount: 0,
      errorMessage: null,
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
        frameCount: frames.length,
        messageCount: stitched.messages.length,
        mediaCount: artifacts.length,
        configVersion: CHAT_PARSER_CONFIG_VERSION,
      },
    }).catch(() => undefined);

    timer.log(`job ${jobId} chat parse complete`, {
      durationSeconds,
      frameCount: frames.length,
      messageCount: stitched.messages.length,
      mediaCount: artifacts.length,
    });
    return timings;
  } catch (error) {
    await Promise.all(createdKeys.map((key) => deleteObject(key).catch(() => undefined)));
    createdKeys = [];
    if (error instanceof Error && /lost import linkage|lost linkage during checkpoint|chat_no_content/.test(error.message)) {
      throw error;
    }
    if (failedAlready) {
      throw error;
    }
    const code = stableErrorCode(error);
    await failOnce(code);
    throw error instanceof Error ? error : new Error(code);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}
