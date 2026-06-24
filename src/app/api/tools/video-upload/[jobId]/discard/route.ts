import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { deleteObject } from "@/lib/storage";
import { getOrCreateSession } from "@/lib/session";
import { computeQualityScore } from "@/lib/video/quality-score";

type Props = { params: Promise<{ jobId: string }> };

export async function PATCH(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
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

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "review") {
    return NextResponse.json(
      { error: "Only jobs awaiting review can be discarded." },
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

  await db
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
    .where(eq(schema.videoJobs.id, jobId));

  await emitVideoJobStatus({
    sessionId: session.id,
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
