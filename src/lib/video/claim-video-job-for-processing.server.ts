import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Statuses from which a worker may atomically claim a video job. */
export const VIDEO_JOB_CLAIMABLE_STATUSES = ["queued", "failed"] as const;

export type ClaimVideoJobResult = "claimed" | "lost_race";

/**
 * CAS claim: queued|failed → extracting.
 *
 * Primary approve fire-and-forget-dispatches while the minute cron also drains
 * `queued` (extraction shadows share the same race). Without this claim, two
 * workers both run OCR and the loser can overwrite `review` via unguarded
 * setStatus before fail-protection applies.
 */
export async function claimVideoJobForProcessing(
  jobId: string,
): Promise<ClaimVideoJobResult> {
  const db = getDb();
  const [claimed] = await db
    .update(schema.videoJobs)
    .set({
      status: "extracting",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        inArray(schema.videoJobs.status, [...VIDEO_JOB_CLAIMABLE_STATUSES]),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  return claimed ? "claimed" : "lost_race";
}
