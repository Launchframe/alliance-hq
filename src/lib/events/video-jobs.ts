import postgres from "postgres";

import { getSqlClient } from "@/lib/db";
import { getListenDatabaseUrl } from "@/lib/db/url";
import type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";

export type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";
export {
  isActiveVideoJobStatus,
  isReviewReadyStatus,
  isTerminalVideoJobStatus,
  parseVideoJobStatusEvent,
} from "@/lib/events/video-jobs-types";

export const VIDEO_JOB_NOTIFY_CHANNEL = "hq_video_jobs";

/**
 * Dedicated connection for LISTEN — do not share with the query pool (SSE).
 * Must use the direct (unpooled) Neon URL: PgBouncer transaction pooling cannot
 * keep a session-scoped LISTEN subscription open. `pg_notify` for this channel
 * still runs through the shared query client elsewhere.
 */
export function createVideoJobListenClient() {
  return postgres(getListenDatabaseUrl(), { prepare: false, max: 1 });
}

export async function emitVideoJobStatus(
  payload: Omit<VideoJobStatusEvent, "updatedAt"> & { updatedAt?: string },
): Promise<void> {
  const event: VideoJobStatusEvent = {
    ...payload,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  };

  try {
    const sql = getSqlClient();
    await sql`SELECT pg_notify(${VIDEO_JOB_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
  } catch (error) {
    console.error("[video-jobs] pg_notify failed:", error);
  }
}
