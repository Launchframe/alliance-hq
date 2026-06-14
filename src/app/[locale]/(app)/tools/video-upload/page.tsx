import { desc, eq } from "drizzle-orm";

import { VideoUploadForm } from "@/components/VideoUploadForm";
import { getDb, schema } from "@/lib/db";
import { requirePageSession } from "@/lib/session";
import type { VideoJobRow } from "@/lib/types/video";

export const dynamic = "force-dynamic";

export default async function VideoUploadPage() {
  const session = await requirePageSession();
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.sessionId, session.id))
    .orderBy(desc(schema.videoJobs.createdAt));

  const initialJobs: VideoJobRow[] = rows.map((job) => ({
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    fileSizeBytes: job.fileSizeBytes,
    category: job.category,
    scoreTarget: job.scoreTarget,
    frameCount: job.frameCount,
    uploadedFrameCount: job.uploadedFrameCount,
    parseSessionId: job.parseSessionId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  }));

  return <VideoUploadForm initialJobs={initialJobs} />;
}
