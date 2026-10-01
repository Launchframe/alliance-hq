import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { VIDEO_ENQUEUE_PERMISSION } from "@/lib/rbac/constants";
import {
  createR2MultipartUpload,
  presignR2PutObject,
  presignR2UploadPart,
  r2Configured,
} from "@/lib/storage/r2";
import { videoStorageKey } from "@/lib/storage";
import { requireApiSession } from "@/lib/session";
import { getScoreTarget } from "@/lib/video/score-targets";
import {
  getMaxVideoUploadBytes,
  isVideoUploadOverLimit,
  MULTIPART_PART_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  multipartPartCount,
} from "@/lib/video/upload-limit";
import { newVideoUploadIds } from "@/lib/video/finalize-video-upload";
import { videoContentTypeFromFileName } from "@/lib/video/resolve-job-video-storage";
import { resolveDepositSlipUploadBankId } from "@/lib/banks/resolve-deposit-slip-upload-bank-id.server";
import { isOfficerChatVideoTarget } from "@/lib/video/chat-video.shared";
import {
  chatAssetMatches,
  chatUploadErrorResponse,
  createChatVideoUploadJob,
  discardChatVideoUploadSetup,
  resolveChatVideoUpload,
} from "@/lib/video/chat-upload.server";
import { defaultVsPerformanceRecordedDate } from "@/lib/video/vs-recorded-date.shared";
import { initializeVsVideoEvidence } from "@/lib/vs-performance/video-evidence.server";
import { vsVideoContextSchema } from "@/lib/vs-performance/video-evidence.shared";

export const dynamic = "force-dynamic";

type InitBody = {
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  scoreTarget?: string;
  boardKey?: string | null;
  hqEventId?: string | null;
  bankId?: string | null;
  knowledgeImportId?: string | null;
  vsContext?: unknown;
};

export async function POST(request: Request) {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;

    const body = (await request.json()) as InitBody;
    const scoreTarget = String(body.scoreTarget ?? "desert-storm");

    if (isOfficerChatVideoTarget(scoreTarget)) {
      return initChatVideoUpload(session, body);
    }

    const denied = await requireSessionPermission(
      session.id,
      VIDEO_ENQUEUE_PERMISSION,
    );
    if (denied) return denied;

    if (!r2Configured()) {
      return NextResponse.json({
        mode: "direct" as const,
        maxUploadBytes: getMaxVideoUploadBytes(),
      });
    }

    const fileName = body.fileName?.trim();
    const fileSize = body.fileSize;

    if (!fileName || fileSize == null || !Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json(
        { error: "fileName and fileSize are required." },
        { status: 400 },
      );
    }

    const target = getScoreTarget(scoreTarget);
    if (!target?.enabled) {
      return NextResponse.json(
        { error: "Score target is not available yet." },
        { status: 400 },
      );
    }

    if (isVideoUploadOverLimit(fileSize)) {
      return NextResponse.json(
        {
          error: `Video must be under ${Math.round(getMaxVideoUploadBytes() / (1024 * 1024))} MB.`,
        },
        { status: 400 },
      );
    }

    const { jobId, groupId } = newVideoUploadIds();
    const storageKey = videoStorageKey(jobId, fileName);
    const contentType =
      body.contentType?.trim() ||
      videoContentTypeFromFileName(fileName);
    const boardKeyStr = body.boardKey ? String(body.boardKey) : null;
    const hqEventIdStr = body.hqEventId ? String(body.hqEventId) : null;
    const bankId = await resolveDepositSlipUploadBankId(
      session.currentAllianceId,
      scoreTarget,
      body.bankId,
    );
    if (body.vsContext != null && scoreTarget !== "vs-performance") {
      return NextResponse.json(
        { error: "invalid", code: "invalid" },
        { status: 400 },
      );
    }
    const vsContextParsed =
      scoreTarget === "vs-performance" && body.vsContext != null
        ? vsVideoContextSchema.safeParse(body.vsContext)
        : null;
    if (vsContextParsed && !vsContextParsed.success) {
      return NextResponse.json(
        { error: "invalid", code: "invalid" },
        { status: 400 },
      );
    }
    const vsContext = vsContextParsed?.success ? vsContextParsed.data : undefined;
    const vsRecordedDate =
      scoreTarget === "vs-performance"
        ? vsContext?.recordedDate ?? defaultVsPerformanceRecordedDate("daily")
        : null;
    const now = new Date();

    const db = getDb();
    await db.insert(schema.videoUploadGroups).values({
      id: groupId,
      sessionId: session.id,
      allianceId: session.currentAllianceId,
      storageKey,
      fileName,
      fileSizeBytes: fileSize,
      scoreTarget,
      boardKey: boardKeyStr,
      hqEventId: hqEventIdStr,
      primaryJobId: null,
      selectedJobId: null,
      accuracyJobId: null,
      comparisonJson: null,
      experimentCampaignId: null,
      experimentArmId: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.videoJobs).values({
      id: jobId,
      sessionId: session.id,
      hqUserId: session.hqUserId,
      status: "pending_upload",
      fileName,
      fileSizeBytes: fileSize,
      category: scoreTarget,
      scoreTarget,
      boardKey: boardKeyStr,
      hqEventId: hqEventIdStr,
      storageKey,
      allianceId: session.currentAllianceId,
      bankId,
      ...(vsRecordedDate ? { recordedDate: vsRecordedDate } : {}),
      enqueuedByHqUserId: session.hqUserId,
      ingestMethod: "video",
      frameCount: null,
      uploadedFrameCount: 0,
      groupId,
      passKey: null,
      passIndex: null,
      passRole: "primary",
      extractionConfigJson: null,
      r2UploadId: null,
      expectedFileSizeBytes: fileSize,
      createdAt: now,
      updatedAt: now,
    });

    if (scoreTarget === "vs-performance") {
      await initializeVsVideoEvidence(jobId, session.id, vsContext);
    }

    const useMultipart = fileSize >= MULTIPART_UPLOAD_THRESHOLD_BYTES;

    if (useMultipart) {
      const uploadId = await createR2MultipartUpload(storageKey, contentType);
      const partCount = multipartPartCount(fileSize);
      const presignedParts = await Promise.all(
        Array.from({ length: partCount }, async (_, index) => {
          const partNumber = index + 1;
          const url = await presignR2UploadPart(storageKey, uploadId, partNumber);
          const start = index * MULTIPART_PART_BYTES;
          const end = Math.min(start + MULTIPART_PART_BYTES, fileSize) - 1;
          return { partNumber, url, start, end };
        }),
      );

      await db
        .update(schema.videoJobs)
        .set({ r2UploadId: uploadId, updatedAt: new Date() })
        .where(eq(schema.videoJobs.id, jobId));

      return NextResponse.json({
        mode: "r2_multipart" as const,
        jobId,
        groupId,
        storageKey,
        uploadId,
        contentType,
        partSize: MULTIPART_PART_BYTES,
        presignedParts,
        maxUploadBytes: getMaxVideoUploadBytes(),
      });
    }

    const putUrl = await presignR2PutObject(storageKey, contentType);

    return NextResponse.json({
      mode: "r2_put" as const,
      jobId,
      groupId,
      storageKey,
      putUrl,
      contentType,
      maxUploadBytes: getMaxVideoUploadBytes(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload init failed",
      },
      { status: 500 },
    );
  }
}

async function initChatVideoUpload(
  session: { id: string; hqUserId: string | null; currentAllianceId: string | null },
  body: InitBody,
): Promise<NextResponse> {
  if (!r2Configured()) {
    return NextResponse.json({
      mode: "direct" as const,
      maxUploadBytes: getMaxVideoUploadBytes(),
    });
  }

  const fileName = body.fileName?.trim();
  const fileSize = body.fileSize;
  if (!fileName || fileSize == null || !Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json(
      { error: "fileName and fileSize are required." },
      { status: 400 },
    );
  }
  if (isVideoUploadOverLimit(fileSize)) {
    return NextResponse.json(
      { error: `Video must be under ${Math.round(getMaxVideoUploadBytes() / (1024 * 1024))} MB.` },
      { status: 400 },
    );
  }

  const resolved = await resolveChatVideoUpload(session, body.knowledgeImportId);
  if ("response" in resolved) return resolved.response;
  const { actor, record, asset } = resolved.context;

  const contentType = body.contentType?.trim() || videoContentTypeFromFileName(fileName);
  if (!chatAssetMatches(asset, { name: fileName, size: fileSize, contentType })) {
    return NextResponse.json(
      { error: "Upload does not match the declared chat video." },
      { status: 400 },
    );
  }

  const storageKey = asset.stagingKey;
  let created: { jobId: string; groupId: string } | null = null;
  let uploadId: string | null = null;
  try {
    const ids = await createChatVideoUploadJob(actor, {
      importId: record.id,
      storageKey,
      fileName,
      fileSizeBytes: fileSize,
      status: "pending_upload",
    });
    created = ids;
    const { jobId, groupId } = ids;

    const useMultipart = fileSize >= MULTIPART_UPLOAD_THRESHOLD_BYTES;
    if (useMultipart) {
      uploadId = await createR2MultipartUpload(storageKey, contentType);
      const partCount = multipartPartCount(fileSize);
      const presignedParts = await Promise.all(
        Array.from({ length: partCount }, async (_, index) => {
          const partNumber = index + 1;
          const url = await presignR2UploadPart(storageKey, uploadId!, partNumber);
          const start = index * MULTIPART_PART_BYTES;
          const end = Math.min(start + MULTIPART_PART_BYTES, fileSize) - 1;
          return { partNumber, url, start, end };
        }),
      );

      const db = getDb();
      await db
        .update(schema.videoJobs)
        .set({ r2UploadId: uploadId, updatedAt: new Date() })
        .where(eq(schema.videoJobs.id, jobId));
      await db
        .update(schema.knowledgeHistoryAssets)
        .set({ r2UploadId: uploadId })
        .where(eq(schema.knowledgeHistoryAssets.id, asset.id));

      return NextResponse.json({
        mode: "r2_multipart" as const,
        jobId,
        groupId,
        storageKey,
        uploadId,
        contentType,
        partSize: MULTIPART_PART_BYTES,
        presignedParts,
        maxUploadBytes: getMaxVideoUploadBytes(),
      });
    }

    const putUrl = await presignR2PutObject(storageKey, contentType);
    return NextResponse.json({
      mode: "r2_put" as const,
      jobId,
      groupId,
      storageKey,
      putUrl,
      contentType,
      maxUploadBytes: getMaxVideoUploadBytes(),
    });
  } catch (error) {
    if (created) {
      await discardChatVideoUploadSetup({
        jobId: created.jobId,
        groupId: created.groupId,
        importId: record.id,
        assetId: asset.id,
        storageKey,
        uploadId,
        allianceId: actor.allianceId,
      }).catch(() => undefined);
    }
    return chatUploadErrorResponse(error);
  }
}
