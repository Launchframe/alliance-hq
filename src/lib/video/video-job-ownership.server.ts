import "server-only";

import { eq, or, type SQL } from "drizzle-orm";

import { schema } from "@/lib/db";

/**
 * Jobs visible to this viewer: the uploading browser session, or any job
 * attributed to their HQ user (cross-device manage).
 */
export function videoJobsOwnedByViewerWhere(
  sessionId: string,
  hqUserId: string | null,
): SQL {
  if (!hqUserId) {
    return eq(schema.videoJobs.sessionId, sessionId);
  }
  return or(
    eq(schema.videoJobs.sessionId, sessionId),
    eq(schema.videoJobs.enqueuedByHqUserId, hqUserId),
    eq(schema.videoJobs.hqUserId, hqUserId),
  )!;
}
