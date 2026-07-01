import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { videoOcrRequiresAshedConnection } from "@/lib/video/ocr-provider.shared";
import { ACTIVE_QUEUE_VIDEO_JOB_STATUSES } from "@/lib/video/video-lifecycle.shared";
import {
  sessionCanProcessVideo,
  sessionCanReadAllianceVideoQueue,
} from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

export type AllianceQueueJob = {
  id: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  boardKey: string | null;
  enqueuedBy: string | null;
  createdAt: string;
  frameCount: number | null;
  uploadedFrameCount: number | null;
  errorMessage: string | null;
};

export async function GET() {
  try {
    const session = await getOrCreateSession();

    if (!(await sessionCanReadAllianceVideoQueue(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allianceId = session.currentAllianceId;
    const [jobs, canProcess, connection] = await Promise.all([
      allianceId
        ? listAllianceActiveVideoJobs(allianceId)
        : Promise.resolve([]),
      sessionCanProcessVideo(session.id),
      getAshedConnection(session.id),
    ]);

    return NextResponse.json({
      jobs,
      canProcess,
      ashedConnected: Boolean(connection),
      ashedRequired: videoOcrRequiresAshedConnection(),
      connectUrl: "/connect",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load queue",
      },
      { status: 500 },
    );
  }
}

/** @deprecated Use listAllianceActiveVideoJobs */
export async function listAlliancePendingVideoJobs(
  allianceId: string,
): Promise<AllianceQueueJob[]> {
  return listAllianceActiveVideoJobs(allianceId);
}

export async function listAllianceActiveVideoJobs(
  allianceId: string,
): Promise<AllianceQueueJob[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.videoJobs.id,
      status: schema.videoJobs.status,
      fileName: schema.videoJobs.fileName,
      scoreTarget: schema.videoJobs.scoreTarget,
      category: schema.videoJobs.category,
      boardKey: schema.videoJobs.boardKey,
      createdAt: schema.videoJobs.createdAt,
      frameCount: schema.videoJobs.frameCount,
      uploadedFrameCount: schema.videoJobs.uploadedFrameCount,
      errorMessage: schema.videoJobs.errorMessage,
      enqueuedByName: schema.hqUsers.displayName,
      enqueuedByEmail: schema.hqUsers.email,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.videoJobs.enqueuedByHqUserId),
    )
    .where(
      and(
        eq(schema.videoJobs.allianceId, allianceId),
        inArray(schema.videoJobs.status, [...ACTIVE_QUEUE_VIDEO_JOB_STATUSES]),
        or(
          eq(schema.videoJobs.passRole, "primary"),
          isNull(schema.videoJobs.passRole),
        ),
      ),
    )
    .orderBy(desc(schema.videoJobs.createdAt));

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    scoreTarget: row.scoreTarget ?? row.category,
    boardKey: row.boardKey,
    enqueuedBy: row.enqueuedByName ?? row.enqueuedByEmail ?? null,
    createdAt: row.createdAt.toISOString(),
    frameCount: row.frameCount,
    uploadedFrameCount: row.uploadedFrameCount,
    errorMessage: row.errorMessage,
  }));
}
