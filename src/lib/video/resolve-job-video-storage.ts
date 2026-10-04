import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

type JobRow = {
  storageKey: string | null;
  archiveStorageKey?: string | null;
  groupId: string | null;
  fileName: string | null;
};

export type JobVideoStorageRow = JobRow;

async function loadPrimaryArchiveStorageKey(
  groupId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      archiveStorageKey: schema.videoJobs.archiveStorageKey,
    })
    .from(schema.videoUploadGroups)
    .innerJoin(
      schema.videoJobs,
      eq(schema.videoUploadGroups.primaryJobId, schema.videoJobs.id),
    )
    .where(eq(schema.videoUploadGroups.id, groupId))
    .limit(1);

  return row?.archiveStorageKey ?? null;
}

/**
 * Resolve the R2/local key for a job's source video.
 *
 * Pass siblings (extraction shadow, etc.) copy the primary upload `storageKey`.
 * After the primary archives, that shared source object is deleted while the
 * sibling still points at it — fall back to the primary's per-job archive.
 */
export async function resolveJobVideoStorageKey(
  job: JobRow,
): Promise<string | null> {
  if (job.archiveStorageKey) {
    return job.archiveStorageKey;
  }

  if (job.groupId) {
    const primaryArchive = await loadPrimaryArchiveStorageKey(job.groupId);
    if (primaryArchive) {
      return primaryArchive;
    }
  }

  if (job.storageKey) {
    return job.storageKey;
  }

  if (!job.groupId) {
    return null;
  }

  const db = getDb();
  const [group] = await db
    .select({ storageKey: schema.videoUploadGroups.storageKey })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.id, job.groupId))
    .limit(1);

  return group?.storageKey ?? null;
}

export function videoContentTypeFromFileName(fileName: string | null): string {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}
