import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import { DEFAULT_PRIMARY_PASS } from "@/lib/video/pass-definitions";
import {
  assignExperiment,
  lookupConfigAssignment,
} from "@/lib/video/experiment-assignment";

export type FinalizeVideoUploadInput = {
  sessionId: string;
  jobId: string;
  groupId: string;
  storageKey: string;
  fileName: string;
  fileSizeBytes: number;
  scoreTarget: string;
  boardKey: string | null;
  hqEventId: string | null;
};

export async function finalizeVideoUploadAndDispatch(
  input: FinalizeVideoUploadInput,
): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [configAssignment, expAssignment] = await Promise.all([
    lookupConfigAssignment({
      scoreTarget: input.scoreTarget,
      boardKey: input.boardKey,
    }),
    assignExperiment({
      scoreTarget: input.scoreTarget,
      boardKey: input.boardKey,
    }),
  ]);

  const primaryConfig = configAssignment?.configJson ?? DEFAULT_PRIMARY_PASS;
  const primaryPassKey = configAssignment?.passKey ?? "scene_0.25";

  await db.insert(schema.videoUploadGroups).values({
    id: input.groupId,
    sessionId: input.sessionId,
    allianceId: null,
    storageKey: input.storageKey,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    scoreTarget: input.scoreTarget,
    boardKey: input.boardKey,
    hqEventId: input.hqEventId,
    primaryJobId: input.jobId,
    selectedJobId: input.jobId,
    accuracyJobId: null,
    comparisonJson: null,
    experimentCampaignId: expAssignment?.campaignId ?? null,
    experimentArmId: expAssignment?.armId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.videoJobs).values({
    id: input.jobId,
    sessionId: input.sessionId,
    status: "queued",
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    category: input.scoreTarget,
    scoreTarget: input.scoreTarget,
    boardKey: input.boardKey,
    hqEventId: input.hqEventId,
    storageKey: input.storageKey,
    ingestMethod: "video",
    frameCount: null,
    uploadedFrameCount: 0,
    groupId: input.groupId,
    passKey: primaryPassKey,
    passIndex: 0,
    passRole: "primary",
    extractionConfigJson: primaryConfig,
    r2UploadId: null,
    expectedFileSizeBytes: null,
    createdAt: now,
    updatedAt: now,
  });

  await writeAuditLog({
    sessionId: input.sessionId,
    action: "video.upload",
    resourceType: "video_job",
    resourceName: input.scoreTarget,
    resourceId: input.jobId,
    metadata: { fileName: input.fileName, bytes: input.fileSizeBytes },
  });

  await emitVideoJobStatus({
    sessionId: input.sessionId,
    jobId: input.jobId,
    status: "queued",
    fileName: input.fileName,
    scoreTarget: input.scoreTarget,
    frameCount: null,
    uploadedFrameCount: 0,
    errorMessage: null,
  });

  dispatchVideoProcessing(input.jobId, { source: "upload" });
}

export function newVideoUploadIds(): { jobId: string; groupId: string } {
  return { jobId: nanoid(16), groupId: nanoid(16) };
}
