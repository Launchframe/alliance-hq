import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";

import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { getDb, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { computeQualityScore } from "@/lib/video/quality-score";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { recoverStaleSubmittingVideoJob } from "@/lib/video/recover-stale-submitting-video-job.server";

type Props = { params: Promise<{ jobId: string }> };

export async function PATCH(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const db = getDb();

  const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
  if (!access.ok) {
    return videoJobAccessErrorResponse(access);
  }
  let job = access.job;

  if (job.status === "submitting") {
    const recovered = await recoverStaleSubmittingVideoJob(jobId);
    if (recovered.recovered) {
      job = { ...job, status: "review" };
    }
  }

  if (job.status !== "review" && job.status !== "failed") {
    return NextResponse.json(
      { error: "Only jobs awaiting review or failed can be discarded." },
      { status: 400 },
    );
  }

  let qualityScore: number | undefined;
  let qualityBucket: string | undefined;

  if (job.parseSessionId) {
    const parsedRows = await db
      .select({
        deleted: schema.parsedRows.deleted,
        edited: schema.parsedRows.edited,
        manuallyAdded: schema.parsedRows.manuallyAdded,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

    const activeRows = parsedRows.filter((row) => row.deleted !== 1);
    const result = computeQualityScore({
      rowsSaved: activeRows.length,
      rowsEdited: activeRows.filter(
        (row) => row.edited === 1 && row.manuallyAdded !== 1,
      ).length,
      rowsDeleted: parsedRows.filter((row) => row.deleted === 1).length,
      rowsAdded: activeRows.filter((row) => row.manuallyAdded === 1).length,
      status: "discarded",
    });
    qualityScore = result.qualityScore;
    qualityBucket = result.qualityBucket;
  }

  const [discarded] = await db
    .update(schema.videoJobs)
    .set({
      status: "discarded",
      updatedAt: new Date(),
      ...(qualityScore != null && qualityBucket != null
        ? {
            qualityScore,
            qualityBucket,
            qualityComputedAt: new Date(),
          }
        : {}),
    })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        or(
          eq(schema.videoJobs.status, "review"),
          eq(schema.videoJobs.status, "failed"),
        ),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (!discarded) {
    return NextResponse.json(
      { error: "Job cannot be discarded in its current state." },
      { status: 409 },
    );
  }

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "discarded",
    fileName: job.fileName,
    scoreTarget: job.scoreTarget ?? job.category,
    errorMessage: null,
  });

  const keysToDelete = new Set<string>();
  if (job.storageKey) keysToDelete.add(job.storageKey);
  if (job.archiveStorageKey) keysToDelete.add(job.archiveStorageKey);
  await Promise.all(
    [...keysToDelete].map((key) => deleteObject(key).catch(() => undefined)),
  );

  return NextResponse.json({ ok: true });
}
