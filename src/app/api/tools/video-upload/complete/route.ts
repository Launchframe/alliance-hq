import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  completeR2MultipartUpload,
  headR2ObjectSize,
  r2Configured,
} from "@/lib/storage/r2";
import { getOrCreateSession } from "@/lib/session";
import { activatePendingVideoUpload } from "@/lib/video/activate-pending-upload";
import {
  getMaxVideoUploadBytes,
  isVideoUploadOverLimit,
} from "@/lib/video/upload-limit";

export const dynamic = "force-dynamic";

type CompleteBody = {
  jobId?: string;
  uploadId?: string;
  parts?: Array<{ partNumber: number; etag: string }>;
};

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const denied = await requireSessionPermission(session.id, "upload:write");
    if (denied) return denied;

    if (!r2Configured()) {
      return NextResponse.json(
        { error: "Direct R2 upload is not configured." },
        { status: 400 },
      );
    }

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

    if (!job || job.status !== "pending_upload" || !job.storageKey) {
      return NextResponse.json(
        { error: "Upload session not found or already completed." },
        { status: 404 },
      );
    }

    if (body.uploadId && job.r2UploadId && body.uploadId !== job.r2UploadId) {
      return NextResponse.json(
        { error: "Upload id does not match this session." },
        { status: 400 },
      );
    }

    if (body.parts && body.parts.length > 0) {
      if (!job.r2UploadId) {
        return NextResponse.json(
          { error: "Multipart completion requires an upload id." },
          { status: 400 },
        );
      }
      await completeR2MultipartUpload(job.storageKey, job.r2UploadId, body.parts);
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
      status: "queued",
      message: "Video uploaded. Processing started — refresh or open review when ready.",
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

/** Allow 1% drift between declared and actual size (rounding / client estimate). */
function MULTIPART_SIZE_TOLERANCE(actualSize: number): number {
  return Math.max(1024, Math.floor(actualSize * 0.01));
}
