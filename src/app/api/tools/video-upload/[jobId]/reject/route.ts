import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { getDb, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

type RejectBody = {
  reason?: string;
};

/** A video processor rejects a pending job, discarding it with an optional reason. */
export async function POST(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    if (!(await sessionCanProcessVideo(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let reason: string | null = null;
    try {
      const body = (await request.json()) as RejectBody;
      reason = body.reason?.trim() || null;
    } catch {
      reason = null;
    }

    const db = getDb();
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (
      session.currentAllianceId &&
      job.allianceId &&
      job.allianceId !== session.currentAllianceId
    ) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Only pending jobs can be rejected." },
        { status: 409 },
      );
    }

    const now = new Date();
    await db
      .update(schema.videoJobs)
      .set({
        status: "discarded",
        errorMessage: reason,
        updatedAt: now,
      })
      .where(eq(schema.videoJobs.id, jobId));

    await writeAuditLog({
      sessionId: session.id,
      allianceId: job.allianceId,
      action: "video.reject",
      resourceType: "video_job",
      resourceName: job.scoreTarget ?? job.category,
      resourceId: jobId,
      metadata: { enqueuedByHqUserId: job.enqueuedByHqUserId, reason },
    });

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "discarded",
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      errorMessage: reason,
    });

    const keysToDelete = new Set<string>();
    if (job.storageKey) keysToDelete.add(job.storageKey);
    if (job.archiveStorageKey) keysToDelete.add(job.archiveStorageKey);
    await Promise.all(
      [...keysToDelete].map((key) => deleteObject(key).catch(() => undefined)),
    );

    return NextResponse.json({ ok: true, jobId, status: "discarded" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reject failed" },
      { status: 500 },
    );
  }
}
