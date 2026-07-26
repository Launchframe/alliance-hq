import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * Pass siblings (extraction shadow, tesseract shadow, etc.) often share the
 * primary upload `storageKey`. Deleting that object while another non-discarded
 * sibling still points at it (and has no archive of its own) breaks preview,
 * reprocess, and playback for the surviving pass.
 */
export async function sourceStillNeededByGroupSiblings(input: {
  jobId: string;
  groupId: string | null;
  sourceKey: string;
}): Promise<boolean> {
  if (!input.groupId) return false;

  const db = getDb();
  const siblings = await db
    .select({
      storageKey: schema.videoJobs.storageKey,
      archiveStorageKey: schema.videoJobs.archiveStorageKey,
      status: schema.videoJobs.status,
    })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.groupId, input.groupId),
        ne(schema.videoJobs.id, input.jobId),
      ),
    );

  return siblings.some(
    (sibling) =>
      sibling.storageKey === input.sourceKey &&
      sibling.archiveStorageKey == null &&
      sibling.status !== "discarded",
  );
}

/** Drop keys that are still required by living pass siblings in the same group. */
export async function filterJobStorageKeysSafeToDelete(input: {
  jobId: string;
  groupId: string | null;
  storageKey: string | null;
  archiveStorageKey: string | null;
}): Promise<string[]> {
  const keys: string[] = [];

  if (input.storageKey) {
    const keepSharedSource = await sourceStillNeededByGroupSiblings({
      jobId: input.jobId,
      groupId: input.groupId,
      sourceKey: input.storageKey,
    });
    if (!keepSharedSource) {
      keys.push(input.storageKey);
    }
  }

  // Archives are per-job (`archiveStorageKey(jobId)`); safe to delete with the job.
  if (input.archiveStorageKey) {
    keys.push(input.archiveStorageKey);
  }

  return keys;
}
