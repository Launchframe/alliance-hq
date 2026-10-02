import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { VIDEO_ENQUEUE_PERMISSION } from "@/lib/rbac/constants";
import {
  completeR2MultipartUpload,
  headR2ObjectSize,
  r2Configured,
} from "@/lib/storage/r2";
import { requireApiSession } from "@/lib/session";
import { activatePendingVideoUpload } from "@/lib/video/activate-pending-upload";
import {
  getMaxVideoUploadBytes,
  isVideoUploadOverLimit,
  multipartPartCount,
} from "@/lib/video/upload-limit";
import { isOfficerChatVideoTarget } from "@/lib/video/chat-video.shared";
import {
  activateChatVideoUpload,
  assertChatVideoTempFile,
  chatUploadErrorResponse,
  resolveChatVideoUpload,
} from "@/lib/video/chat-upload.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { streamObjectToFile } from "@/lib/storage";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const dynamic = "force-dynamic";

type CompleteBody = {
  jobId?: string;
  uploadId?: string;
  parts?: Array<{ partNumber: number; etag: string }>;
};

export async function POST(request: Request) {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;

    const body = (await request.json()) as CompleteBody;
    const jobId = body.jobId?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    const db = getDb();
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          eq(schema.videoJobs.sessionId, session.id),
        ),
      )
      .limit(1);

    if (isOfficerChatVideoTarget(job?.scoreTarget)) {
      return completeChatVideoUpload(session, job!, body);
    }

    const denied = await requireSessionPermission(
      session.id,
      VIDEO_ENQUEUE_PERMISSION,
    );
    if (denied) return denied;

    if (!r2Configured()) {
      return NextResponse.json(
        { error: "Direct R2 upload is not configured." },
        { status: 400 },
      );
    }

    if (!job || job.status !== "pending_upload" || !job.storageKey) {
      return NextResponse.json(
        { error: "Upload session not found or already completed." },
        { status: 404 },
      );
    }

    if (job.r2UploadId) {
      if (body.uploadId !== job.r2UploadId) {
        return NextResponse.json(
          { error: "Upload id does not match this session." },
          { status: 400 },
        );
      }
      if (!validMultipartParts(body.parts)) {
        return NextResponse.json(
          { error: "Multipart completion requires the uploaded part list." },
          { status: 400 },
        );
      }
      await completeR2MultipartUpload(job.storageKey, job.r2UploadId, body.parts!);
    } else if (body.uploadId || (body.parts && body.parts.length > 0)) {
      return NextResponse.json(
        { error: "Multipart fields do not match this upload session." },
        { status: 400 },
      );
    }

    const actualSize = await headR2ObjectSize(job.storageKey);

    if (isVideoUploadOverLimit(actualSize)) {
      return NextResponse.json(
        {
          error: `Uploaded video exceeds the ${Math.round(getMaxVideoUploadBytes() / (1024 * 1024))} MB limit.`,
        },
        { status: 400 },
      );
    }

    if (
      job.expectedFileSizeBytes != null &&
      Math.abs(actualSize - job.expectedFileSizeBytes) > MULTIPART_SIZE_TOLERANCE(actualSize)
    ) {
      return NextResponse.json(
        { error: "Uploaded size does not match the declared file size." },
        { status: 400 },
      );
    }

    await activatePendingVideoUpload(jobId, session.id, actualSize);

    return NextResponse.json({
      ok: true,
      jobId,
      status: "pending_approval",
      message:
        "Video uploaded. Waiting for a video processor to review and run it.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload complete failed",
      },
      { status: 500 },
    );
  }
}

function validMultipartParts(
  parts: CompleteBody["parts"],
): parts is Array<{ partNumber: number; etag: string }> {
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every(
      (part) =>
        !!part &&
        typeof part.partNumber === "number" &&
        Number.isInteger(part.partNumber) &&
        part.partNumber >= 1 &&
        typeof part.etag === "string" &&
        part.etag.trim() !== "",
    ) &&
    new Set(parts.map((part) => part.partNumber)).size === parts.length
  );
}

function MULTIPART_SIZE_TOLERANCE(actualSize: number): number {
  return Math.max(1024, Math.floor(actualSize * 0.01));
}

async function completeChatVideoUpload(
  session: { id: string; hqUserId: string | null; currentAllianceId: string | null },
  job: typeof schema.videoJobs.$inferSelect,
  body: CompleteBody,
): Promise<NextResponse> {
  const invalid = (error: string, status = 400) =>
    NextResponse.json({ error }, { status });
  if (!job || job.status !== "pending_upload" || !job.storageKey || !job.groupId) {
    return invalid("Upload session not found or already completed.", 404);
  }
  if (!r2Configured()) {
    return invalid("Direct R2 upload is not configured.");
  }

  const resolved = await resolveChatVideoUpload(session, job.knowledgeImportId);
  if ("response" in resolved) return resolved.response;
  const { actor, record, asset } = resolved.context;
  if (
    record.sourceVideoJobId !== job.id ||
    asset.stagingKey !== job.storageKey ||
    asset.sealedKey
  ) {
    return invalid("Upload does not match the declared chat video.", 409);
  }

  if (job.r2UploadId) {
    if (body.uploadId !== job.r2UploadId) {
      return invalid("Upload id does not match this session.");
    }
    if (!validMultipartParts(body.parts)) {
      return invalid("Multipart completion requires the uploaded part list.");
    }
    const declaredSize = job.expectedFileSizeBytes;
    const expectedCount = declaredSize != null && declaredSize > 0 ? multipartPartCount(declaredSize) : null;
    const maxCount = multipartPartCount(getMaxVideoUploadBytes());
    if (expectedCount == null || expectedCount > maxCount || body.parts!.length !== expectedCount) {
      return invalid("Multipart part count does not match the declared upload.");
    }
    const sorted = [...body.parts!].sort((a, b) => a.partNumber - b.partNumber);
    if (sorted.some((part, index) => part.partNumber !== index + 1)) {
      return invalid("Multipart part list must cover parts 1 through the declared part count.");
    }
    await completeR2MultipartUpload(job.storageKey, job.r2UploadId, sorted);
  } else if (body.uploadId || (body.parts && body.parts.length > 0)) {
    return invalid("Multipart fields do not match this upload session.");
  }

  const actualSize = await headR2ObjectSize(job.storageKey);
  if (isVideoUploadOverLimit(actualSize)) {
    return invalid(
      `Uploaded video exceeds the ${Math.round(getMaxVideoUploadBytes() / (1024 * 1024))} MB limit.`,
    );
  }
  if (
    job.expectedFileSizeBytes != null &&
    Math.abs(actualSize - job.expectedFileSizeBytes) > MULTIPART_SIZE_TOLERANCE(actualSize)
  ) {
    return invalid("Uploaded size does not match the declared file size.");
  }

  const tmpPath = path.join(
    os.tmpdir(),
    `hq-chat-complete-${job.id}${path.extname(job.fileName ?? ".mp4")}`,
  );
  try {
    await streamObjectToFile(job.storageKey, tmpPath, getMaxVideoUploadBytes());
    await assertChatVideoTempFile(tmpPath, asset.contentType);
  } catch (error) {
    const { failChatVideoUpload } = await import("@/lib/video/chat-upload.server");
    await failChatVideoUpload({
      jobId: job.id,
      importId: record.id,
      allianceId: actor.allianceId,
      sessionId: session.id,
      fileName: job.fileName,
      errorMessage: "chat_video_invalid",
    });
    return invalid(
      error instanceof Error ? error.message : "Invalid chat video.",
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }

  try {
    await activateChatVideoUpload({
      sessionId: session.id,
      hqUserId: session.hqUserId,
      jobId: job.id,
      groupId: job.groupId,
      importId: record.id,
      allianceId: actor.allianceId,
      assetId: asset.id,
      storageKey: job.storageKey,
      fileName: job.fileName,
      actualSizeBytes: actualSize,
    });
  } catch (error) {
    return chatUploadErrorResponse(
      error instanceof KnowledgeAccessError ? error : error,
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: job.id,
    status: "queued",
    message:
      "Video uploaded. Waiting for a video processor to review and run it.",
  });
}
