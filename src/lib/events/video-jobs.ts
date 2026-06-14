import postgres from "postgres";

import { getDatabaseUrl } from "@/lib/db/url";
import type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";

export type { VideoJobStatusEvent } from "@/lib/events/video-jobs-types";
export {
  isActiveVideoJobStatus,
  isReviewReadyStatus,
  isTerminalVideoJobStatus,
  parseVideoJobStatusEvent,
} from "@/lib/events/video-jobs-types";

export const VIDEO_JOB_NOTIFY_CHANNEL = "hq_video_jobs";

let notifyClient: ReturnType<typeof postgres> | null = null;

function getNotifyClient() {
  if (!notifyClient) {
    notifyClient = postgres(getDatabaseUrl(), { prepare: false, max: 1 });
  }
  return notifyClient;
}

export function createVideoJobListenClient() {
  return postgres(getDatabaseUrl(), { prepare: false, max: 1 });
}

export async function emitVideoJobStatus(
  payload: Omit<VideoJobStatusEvent, "updatedAt"> & { updatedAt?: string },
): Promise<void> {
  const event: VideoJobStatusEvent = {
    ...payload,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  };

  try {
    const sql = getNotifyClient();
    await sql`SELECT pg_notify(${VIDEO_JOB_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
  } catch (error) {
    console.error("[video-jobs] pg_notify failed:", error);
  }
}
