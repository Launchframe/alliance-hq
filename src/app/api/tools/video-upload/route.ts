import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { putObject, videoStorageKey } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import { getScoreTarget, ENABLED_SCORE_TARGETS } from "@/lib/video/score-targets";

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const formData = await request.formData();
    const file = formData.get("video");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file provided." },
        { status: 400 },
      );
    }

    const scoreTarget = String(
      formData.get("scoreTarget") ?? formData.get("category") ?? "desert-storm",
    );
    const target = getScoreTarget(scoreTarget);
    if (!target?.enabled) {
      return NextResponse.json(
        { error: "Score target is not available yet." },
        { status: 400 },
      );
    }

    const maxBytes = 200 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: "Video must be under 200 MB for now." },
        { status: 400 },
      );
    }

    const jobId = nanoid(16);
    const storageKey = videoStorageKey(jobId, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(storageKey, buffer);

    const db = getDb();
    const now = new Date();

    await db.insert(schema.videoJobs).values({
      id: jobId,
      sessionId: session.id,
      status: "queued",
      fileName: file.name,
      fileSizeBytes: file.size,
      category: scoreTarget,
      scoreTarget,
      storageKey,
      ingestMethod: "video",
      frameCount: null,
      uploadedFrameCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog({
      sessionId: session.id,
      action: "video.upload",
      resourceType: "video_job",
      resourceName: scoreTarget,
      resourceId: jobId,
      metadata: { fileName: file.name, bytes: file.size },
    });

    await emitVideoJobStatus({
      sessionId: session.id,
      jobId,
      status: "queued",
      fileName: file.name,
      scoreTarget,
      frameCount: null,
      uploadedFrameCount: 0,
      errorMessage: null,
    });

    dispatchVideoProcessing(jobId, { source: "upload" });

    return NextResponse.json({
      ok: true,
      jobId,
      status: "queued",
      message: "Video uploaded. Processing started — refresh or open review when ready.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const session = await getOrCreateSession();
    const db = getDb();
    const jobs = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.sessionId, session.id))
      .orderBy(desc(schema.videoJobs.createdAt));

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        status: job.status,
        fileName: job.fileName,
        fileSizeBytes: job.fileSizeBytes,
        scoreTarget: job.scoreTarget ?? job.category,
        frameCount: job.frameCount,
        uploadedFrameCount: job.uploadedFrameCount,
        parseSessionId: job.parseSessionId,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
      })),
      scoreTargets: ENABLED_SCORE_TARGETS.map((t) => ({
        id: t.id,
        labelKey: t.labelKey,
        group: t.group,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to list jobs",
      },
      { status: 500 },
    );
  }
}
