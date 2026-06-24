import { eq } from "drizzle-orm";
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
    await deleteObject(sourceKey);

    await db
      .update(schema.videoJobs)
      .set({
        archiveStorageKey: archiveKey,
        archivedAt: new Date(),
        originalFileSizeBytes: originalSize,
        updatedAt: new Date(),
      })
      .where(eq(schema.videoJobs.id, jobId));

    logPipelineStep("ffmpeg.archive_source", Date.now() - started, {
      jobId,
      originalBytes: originalSize,
      archiveBytes: archiveBuffer.length,
    });
  } finally {
    await fs.unlink(tmpSource).catch(() => undefined);
    if (tmpArchive) {
      await fs.unlink(tmpArchive).catch(() => undefined);
    }
  }
}
