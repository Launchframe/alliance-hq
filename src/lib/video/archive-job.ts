import { and, eq, ne } from "drizzle-orm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getDb, schema } from "@/lib/db";
import {
  archiveStorageKey,
  deleteObject,
  getObjectSize,
  putObject,
  streamObjectToFile,
} from "@/lib/storage";
import { transcodeVideoArchiveToTemp } from "@/lib/video/archive-source";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";

async function sourceStillNeededBySiblings(
  jobId: string,
  groupId: string | null,
  sourceKey: string,
): Promise<boolean> {
  if (!groupId) return false;
  const db = getDb();
  const siblings = await db
    .select({
      storageKey: schema.videoJobs.storageKey,
      archiveStorageKey: schema.videoJobs.archiveStorageKey,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, groupId),
        ne(schema.videoJobs.id, jobId),
      ),
    );
  return siblings.some(
    (sibling) =>
      sibling.storageKey === sourceKey && sibling.archiveStorageKey == null,
  );
}

export async function archiveVideoJobSource(jobId: string): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job?.storageKey) {
    throw new Error(`Job not found or missing source: ${jobId}`);
  }
  if (job.archiveStorageKey) {
    return;
  }
  if (job.status !== "review" && job.status !== "complete" && job.status !== "submitting") {
    throw new Error(`Job ${jobId} is not ready for archival (${job.status}).`);
  }

  const sourceKey = job.storageKey;
  const archiveKey = archiveStorageKey(jobId);
  const originalSize = job.fileSizeBytes ?? (await getObjectSize(sourceKey));

  const tmpSource = path.join(
    os.tmpdir(),
    `hq-video-archive-src-${jobId}${path.extname(job.fileName ?? ".mp4")}`,
  );
  let tmpArchive: string | null = null;

  const started = Date.now();
  try {
    await streamObjectToFile(sourceKey, tmpSource);
    tmpArchive = await transcodeVideoArchiveToTemp(tmpSource, jobId);
    const archiveBuffer = await fs.readFile(tmpArchive);
    await putObject(archiveKey, archiveBuffer);

    await db
      .update(schema.videoJobs)
      .set({
        archiveStorageKey: archiveKey,
        archivedAt: new Date(),
        originalFileSizeBytes: originalSize,
        updatedAt: new Date(),
      })
      .where(eq(schema.videoJobs.id, jobId));

    // Shadow / sibling jobs often share this storageKey. Deleting while they
    // still need the source makes early/late extraction shadows fail with no
    // clean retry (one-shadow-per-group unique index). Persist this job's
    // archive first so concurrent archivers observe it before deciding delete.
    const keepSharedSource = await sourceStillNeededBySiblings(
      jobId,
      job.groupId ?? null,
      sourceKey,
    );
    if (!keepSharedSource) {
      await deleteObject(sourceKey);
    }

    logPipelineStep("ffmpeg.archive_source", Date.now() - started, {
      jobId,
      originalBytes: originalSize,
      archiveBytes: archiveBuffer.length,
      deletedSource: !keepSharedSource,
    });
  } finally {
    await fs.unlink(tmpSource).catch(() => undefined);
    if (tmpArchive) {
      await fs.unlink(tmpArchive).catch(() => undefined);
    }
  }
}
