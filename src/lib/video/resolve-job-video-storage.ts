import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

type JobRow = {
  storageKey: string | null;
  groupId: string | null;
  fileName: string | null;
};

export async function resolveJobVideoStorageKey(
  job: JobRow,
): Promise<string | null> {
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
