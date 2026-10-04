import { getObjectSize } from "@/lib/storage";
import {
  resolveJobVideoStorageKey,
  type JobVideoStorageRow,
} from "@/lib/video/resolve-job-video-storage";

export class VideoJobStorageUnavailableError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "VideoJobStorageUnavailableError";
  }
}

/** Verify the resolved video object exists before destructive reprocess resets. */
export async function assertJobVideoStorageAvailable(
  job: JobVideoStorageRow,
): Promise<string> {
  const storageKey = await resolveJobVideoStorageKey(job);
  if (!storageKey) {
    throw new VideoJobStorageUnavailableError("Job has no stored video.");
  }

  try {
    await getObjectSize(storageKey);
  } catch {
    throw new VideoJobStorageUnavailableError(
      "The source video is no longer in storage. Reprocess the primary pass or re-upload the clip.",
    );
  }

  return storageKey;
}
