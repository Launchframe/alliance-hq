import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { getDb, schema } from "@/lib/db";
import { resolvePrimaryExtractionForUpload } from "@/lib/video/experiment-assignment";

export async function activatePendingVideoUpload(
  jobId: string,
  sessionId: string,
  fileSizeBytes: number,
): Promise<void> {
  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job || job.sessionId !== sessionId) {
    throw new Error("Upload session not found.");
  }
  if (job.status !== "pending_upload") {
    throw new Error("Upload is not awaiting completion.");
  }
  if (!job.groupId || !job.storageKey) {
    throw new Error("Upload session is missing storage metadata.");
  }

  const scoreTarget = job.scoreTarget ?? job.category ?? "desert-storm";
  const boardKeyStr = job.boardKey ?? null;

  const primary = await resolvePrimaryExtractionForUpload({
    scoreTarget,
    boardKey: boardKeyStr,
  });
  const now = new Date();

  await db
    .update(schema.videoUploadGroups)
    .set({
      fileSizeBytes: fileSizeBytes,
      primaryJobId: jobId,
      selectedJobId: jobId,
      experimentCampaignId: primary.experimentCampaignId,
      experimentArmId: primary.experimentArmId,
      updatedAt: now,
    })
    .where(eq(schema.videoUploadGroups.id, job.groupId));

  await db
    .update(schema.videoJobs)
    .set({
      status: "pending_approval",
      fileSizeBytes: fileSizeBytes,
      passKey: primary.passKey,
      passIndex: 0,
      passRole: "primary",
      extractionConfigJson: primary.configJson,
      r2UploadId: null,
      expectedFileSizeBytes: null,
      updatedAt: now,
    })
    .where(eq(schema.videoJobs.id, jobId));

  await writeAuditLog({
    sessionId,
    action: "video.upload",
    resourceType: "video_job",
    resourceName: scoreTarget,
    resourceId: jobId,
    metadata: { fileName: job.fileName, bytes: fileSizeBytes },
  });

  await emitVideoJobStatus({
    ...videoJobStatusOwnerFields(job),
    jobId,
    status: "pending_approval",
    fileName: job.fileName,
    scoreTarget,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
  });
}
