import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import fs from "node:fs/promises";

import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getKnowledgeActorForSession, type KnowledgeWebActor } from "@/lib/notes/access.server";
import { getOwnedHistoryImport } from "@/lib/notes/imports.server";
import { KnowledgeAccessError, recheckKnowledgeActor } from "@/lib/notes/resources.server";
import { newVideoUploadIds } from "@/lib/video/finalize-video-upload";
import { isVideoUploadOverLimit } from "@/lib/video/upload-limit";
import { probeVideoDurationSeconds } from "@/lib/video/frame-extractor";
import {
  CHAT_VIDEO_CONTENT_TYPES,
  CHAT_VIDEO_EXTRACTION_CONFIG,
  CHAT_VIDEO_MAX_DURATION_SECONDS,
  OFFICER_CHAT_VIDEO_TARGET,
  isChatVideoSignature,
} from "@/lib/video/chat-video.shared";

const imports = schema.knowledgeHistoryImports;
const assets = schema.knowledgeHistoryAssets;

type ApiSession = { id: string; hqUserId: string | null; currentAllianceId: string | null };

export function chatUploadErrorResponse(error: unknown): NextResponse {
  if (error instanceof KnowledgeAccessError) {
    return NextResponse.json({ error: error.code, code: error.code }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Upload failed" },
    { status: 500 },
  );
}

export type ChatUploadContext = {
  actor: KnowledgeWebActor;
  record: typeof imports.$inferSelect;
  asset: typeof assets.$inferSelect;
};

export async function resolveChatVideoUpload(
  session: ApiSession,
  knowledgeImportId: string | null | undefined,
): Promise<{ context: ChatUploadContext } | { response: NextResponse }> {
  if (!knowledgeImportId) {
    return { response: NextResponse.json({ error: "knowledgeImportId is required." }, { status: 400 }) };
  }
  try {
    const denied = await requireSessionPermission(session.id, "notes:create");
    if (denied) return { response: denied };
    const actor = await getKnowledgeActorForSession(session.id);
    if (!actor?.canCreate || !actor.isOfficer || actor.allianceId !== session.currentAllianceId) {
      return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    const record = await getOwnedHistoryImport(actor, knowledgeImportId);
    if (record.kind !== "video" || record.state !== "uploading") {
      throw new KnowledgeAccessError("changed");
    }
    const files = await getDb().select().from(assets)
      .where(and(eq(assets.importId, record.id), eq(assets.allianceId, actor.allianceId)))
      .orderBy(assets.position);
    if (files.length !== 1) throw new KnowledgeAccessError("invalid");
    return { context: { actor, record, asset: files[0]! } };
  } catch (error) {
    return { response: chatUploadErrorResponse(error) };
  }
}

export function chatAssetMatches(
  asset: typeof assets.$inferSelect,
  file: { name: string; size: number; contentType: string },
): boolean {
  return (
    asset.name === file.name &&
    asset.size === file.size &&
    asset.contentType === file.contentType &&
    (CHAT_VIDEO_CONTENT_TYPES as readonly string[]).includes(file.contentType) &&
    file.size > 0 &&
    !isVideoUploadOverLimit(file.size)
  );
}

export async function createChatVideoUploadJob(
  actor: KnowledgeWebActor,
  input: {
    importId: string;
    storageKey: string;
    fileName: string;
    fileSizeBytes: number;
    status: "pending_upload" | "pending_approval";
  },
): Promise<{ jobId: string; groupId: string }> {
  const { jobId, groupId } = newVideoUploadIds();
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    if (!actor.canCreate || !actor.isOfficer || !actor.hqUserId || actor.kind !== "web") {
      throw new KnowledgeAccessError("forbidden");
    }
    const [record] = await tx
      .select()
      .from(imports)
      .where(and(eq(imports.id, input.importId), eq(imports.allianceId, actor.allianceId)))
      .for("update");
    if (
      !record ||
      record.kind !== "video" ||
      record.state !== "uploading" ||
      record.sourceVideoJobId !== null
    ) {
      throw new KnowledgeAccessError("changed");
    }
    const [resource] = await tx
      .select()
      .from(schema.knowledgeResources)
      .where(
        and(
          eq(schema.knowledgeResources.id, record.resourceId),
          eq(schema.knowledgeResources.allianceId, actor.allianceId),
        ),
      )
      .for("update");
    if (
      !resource ||
      resource.archivedAt ||
      resource.ownershipState !== "hq" ||
      resource.ownerHqUserId !== actor.hqUserId
    ) {
      throw new KnowledgeAccessError("forbidden");
    }
    const files = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.importId, record.id), eq(assets.allianceId, actor.allianceId)))
      .for("update");
    const [asset] = files;
    if (
      files.length !== 1 ||
      !asset ||
      asset.stagingKey !== input.storageKey ||
      asset.sealedKey !== null ||
      asset.r2UploadId !== null
    ) {
      throw new KnowledgeAccessError("changed");
    }
    await tx.insert(schema.videoUploadGroups).values({
      id: groupId,
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      storageKey: input.storageKey,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
      boardKey: null,
      hqEventId: null,
      primaryJobId: input.status === "pending_approval" ? jobId : null,
      selectedJobId: input.status === "pending_approval" ? jobId : null,
      accuracyJobId: null,
      comparisonJson: null,
      experimentCampaignId: null,
      experimentArmId: null,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.videoJobs).values({
      id: jobId,
      sessionId: actor.sessionId,
      hqUserId: actor.hqUserId,
      status: input.status,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      category: OFFICER_CHAT_VIDEO_TARGET,
      scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
      storageKey: input.storageKey,
      allianceId: actor.allianceId,
      enqueuedByHqUserId: actor.hqUserId,
      ingestMethod: "video",
      uploadedFrameCount: 0,
      groupId,
      passIndex: input.status === "pending_approval" ? 0 : null,
      passRole: "primary",
      extractionConfigJson: CHAT_VIDEO_EXTRACTION_CONFIG,
      expectedFileSizeBytes: input.status === "pending_upload" ? input.fileSizeBytes : null,
      knowledgeImportId: input.importId,
      createdAt: now,
      updatedAt: now,
    });
    const linked = await tx
      .update(imports)
      .set({ sourceVideoJobId: jobId, updatedAt: now })
      .where(and(eq(imports.id, input.importId), eq(imports.allianceId, actor.allianceId), isNull(imports.sourceVideoJobId)))
      .returning({ id: imports.id });
    if (linked.length !== 1) throw new KnowledgeAccessError("changed");
  });
  return { jobId, groupId };
}

export async function discardChatVideoUploadSetup(input: {
  jobId: string;
  groupId: string;
  importId: string;
  assetId: string;
  storageKey: string;
  uploadId: string | null;
  allianceId: string;
}): Promise<void> {
  if (input.uploadId) {
    const { abortR2MultipartUpload } = await import("@/lib/storage/r2");
    await abortR2MultipartUpload(input.storageKey, input.uploadId).catch(() => undefined);
  }
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx
      .update(imports)
      .set({ sourceVideoJobId: null, updatedAt: now })
      .where(and(eq(imports.id, input.importId), eq(imports.sourceVideoJobId, input.jobId)));
    await tx
      .update(assets)
      .set({ r2UploadId: null })
      .where(and(eq(assets.id, input.assetId), eq(assets.importId, input.importId), input.uploadId ? eq(assets.r2UploadId, input.uploadId) : isNull(assets.r2UploadId)));
    await tx
      .delete(schema.videoJobs)
      .where(and(eq(schema.videoJobs.id, input.jobId), eq(schema.videoJobs.status, "pending_upload"), eq(schema.videoJobs.knowledgeImportId, input.importId)));
    await tx
      .delete(schema.videoUploadGroups)
      .where(and(eq(schema.videoUploadGroups.id, input.groupId), isNull(schema.videoUploadGroups.primaryJobId)));
  });
}

export async function activateChatVideoUpload(input: {
  sessionId: string;
  jobId: string;
  groupId: string;
  importId: string;
  allianceId: string;
  assetId: string;
  storageKey: string;
  fileName: string | null;
  actualSizeBytes: number;
}): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [group] = await tx.update(schema.videoUploadGroups).set({
      fileSizeBytes: input.actualSizeBytes,
      primaryJobId: input.jobId,
      selectedJobId: input.jobId,
      updatedAt: now,
    }).where(and(
      eq(schema.videoUploadGroups.id, input.groupId),
      or(isNull(schema.videoUploadGroups.primaryJobId), eq(schema.videoUploadGroups.primaryJobId, input.jobId)),
    )).returning({ id: schema.videoUploadGroups.id });
    if (!group) throw new KnowledgeAccessError("changed");
    const [job] = await tx.update(schema.videoJobs).set({
      status: "pending_approval",
      fileSizeBytes: input.actualSizeBytes,
      passIndex: 0,
      passRole: "primary",
      r2UploadId: null,
      expectedFileSizeBytes: null,
      updatedAt: now,
    }).where(and(
      eq(schema.videoJobs.id, input.jobId),
      eq(schema.videoJobs.status, "pending_upload"),
      eq(schema.videoJobs.knowledgeImportId, input.importId),
      eq(schema.videoJobs.storageKey, input.storageKey),
      eq(schema.videoJobs.groupId, input.groupId),
      eq(schema.videoJobs.sessionId, input.sessionId),
      eq(schema.videoJobs.allianceId, input.allianceId),
    )).returning({ id: schema.videoJobs.id });
    if (!job) throw new KnowledgeAccessError("changed");
    const [sealed] = await tx.update(assets).set({
      sealedKey: input.storageKey,
      sealedAt: now,
      r2UploadId: null,
    }).where(and(
      eq(assets.id, input.assetId),
      eq(assets.importId, input.importId),
      eq(assets.allianceId, input.allianceId),
      eq(assets.stagingKey, input.storageKey),
      isNull(assets.sealedKey),
    )).returning({ id: assets.id });
    if (!sealed) throw new KnowledgeAccessError("changed");
    const [activated] = await tx.update(imports).set({ state: "pending_approval", updatedAt: now })
      .where(and(
        eq(imports.id, input.importId),
        eq(imports.allianceId, input.allianceId),
        eq(imports.state, "uploading"),
        eq(imports.sourceVideoJobId, input.jobId),
      )).returning({ id: imports.id });
    if (!activated) throw new KnowledgeAccessError("changed");
  });
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    action: "video.upload",
    resourceType: "video_job",
    resourceName: OFFICER_CHAT_VIDEO_TARGET,
    resourceId: input.jobId,
    metadata: { fileName: input.fileName, bytes: input.actualSizeBytes, importId: input.importId },
  });
  await emitVideoJobStatus({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    jobId: input.jobId,
    status: "pending_approval",
    fileName: input.fileName,
    scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
  });
}

export async function assertChatVideoTempFile(
  tempPath: string,
  contentType: string,
): Promise<{ durationSeconds: number }> {
  const handle = await fs.open(tempPath, "r");
  let head: Buffer;
  try {
    head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
  } finally {
    await handle.close();
  }
  if (!isChatVideoSignature(head, contentType)) {
    throw new Error("Unsupported chat video container.");
  }
  const durationSeconds = await probeVideoDurationSeconds(tempPath);
  if (durationSeconds == null) {
    throw new Error("Chat video duration could not be read.");
  }
  if (durationSeconds > CHAT_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error("Chat video exceeds the 2 minute limit.");
  }
  return { durationSeconds };
}

export async function failChatVideoUpload(input: {
  jobId: string;
  importId: string;
  allianceId: string;
  sessionId: string;
  fileName: string | null;
  errorMessage: string;
}): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(schema.videoJobs).set({ status: "failed", errorMessage: input.errorMessage, updatedAt: now })
      .where(and(eq(schema.videoJobs.id, input.jobId), inArray(schema.videoJobs.status, ["pending_upload", "pending_approval", "queued", "extracting", "parsing"])));
    await tx.update(imports).set({ state: "failed", updatedAt: now })
      .where(and(eq(imports.id, input.importId), inArray(imports.state, ["uploading", "pending_approval", "processing"])));
  });
  await emitVideoJobStatus({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    jobId: input.jobId,
    status: "failed",
    fileName: input.fileName,
    scoreTarget: OFFICER_CHAT_VIDEO_TARGET,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: input.errorMessage,
    stage: "failed",
  }).catch(() => undefined);
}


