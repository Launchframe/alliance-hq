import { NextResponse } from "next/server";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { VIDEO_ENQUEUE_PERMISSION } from "@/lib/rbac/constants";
import { putObject, videoStorageKey, r2Configured } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { getScoreTarget, ENABLED_SCORE_TARGETS } from "@/lib/video/score-targets";
import {
  getMaxVideoUploadBytes,
  getMaxVideoUploadMb,
  isLegacyDirectPostOverLimit,
  LEGACY_DIRECT_POST_MAX_BYTES,
  MULTIPART_PART_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
} from "@/lib/video/upload-limit";
import { finalizeVideoUploadEnqueue } from "@/lib/video/finalize-video-upload";
import { videoJobsOwnedByViewerWhere } from "@/lib/video/video-job-ownership.server";

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const denied = await requireSessionPermission(
      session.id,
      VIDEO_ENQUEUE_PERMISSION,
    );
    if (denied) return denied;

    if (r2Configured()) {
      return NextResponse.json(
        {
          error:
            "Use the direct upload flow (init → R2 → complete). Legacy POST is only for local dev without R2.",
        },
        { status: 400 },
      );
    }

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
    const boardKey = formData.get("boardKey");
    const hqEventId = formData.get("hqEventId");
    const fixtureIdParam = formData.get("fixtureId");
    const fixtureDayIndexParam = formData.get("fixtureDayIndex");
    const target = getScoreTarget(scoreTarget);
    if (!target?.enabled) {
      return NextResponse.json(
        { error: "Score target is not available yet." },
        { status: 400 },
      );
    }

    if (isLegacyDirectPostOverLimit(file.size)) {
      return NextResponse.json(
        {
          error: `Video must be under ${Math.round(LEGACY_DIRECT_POST_MAX_BYTES / (1024 * 1024))} MB for direct upload through the app server. Configure R2 for larger files.`,
        },
        { status: 400 },
      );
    }

    if (file.size > getMaxVideoUploadBytes()) {
      return NextResponse.json(
        {
          error: `Video must be under ${getMaxVideoUploadMb()} MB.`,
        },
        { status: 400 },
      );
    }

    const groupId = nanoid(16);
    const jobId = nanoid(16);
    const storageKey = videoStorageKey(jobId, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(storageKey, buffer);

    await finalizeVideoUploadEnqueue({
      sessionId: session.id,
      jobId,
      groupId,
      storageKey,
      fileName: file.name,
      fileSizeBytes: file.size,
      scoreTarget,
      boardKey: boardKey ? String(boardKey) : null,
      hqEventId: hqEventId ? String(hqEventId) : null,
      allianceId: session.currentAllianceId,
      enqueuedByHqUserId: session.hqUserId,
      fixtureId: fixtureIdParam ? String(fixtureIdParam) : null,
      fixtureDayIndex: fixtureDayIndexParam != null ? Number(fixtureDayIndexParam) : null,
    });

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
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const session = await getOrCreateSession();
    const denied = await requireSessionPermission(
      session.id,
      VIDEO_ENQUEUE_PERMISSION,
    );
    if (denied) return denied;

    const db = getDb();
    const jobs = await db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          videoJobsOwnedByViewerWhere(session.id, session.hqUserId),
          ne(schema.videoJobs.status, "discarded"),
          ne(schema.videoJobs.status, "pending_upload"),
          or(
            eq(schema.videoJobs.passRole, "primary"),
            isNull(schema.videoJobs.passRole),
          ),
        ),
      )
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
        leaderboardModel: t.leaderboardModel,
        boardTypes: t.boardTypes,
        usesHqEvents: t.seriesEntity === "EventSeries",
        inHouseOcrAccuracy: t.inHouseOcrAccuracy,
      })),
      upload: {
        mode: r2Configured() ? "r2" : "direct",
        maxUploadBytes: getMaxVideoUploadBytes(),
        multipartThresholdBytes: MULTIPART_UPLOAD_THRESHOLD_BYTES,
        multipartPartBytes: MULTIPART_PART_BYTES,
        legacyDirectPostMaxBytes: LEGACY_DIRECT_POST_MAX_BYTES,
      },
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
