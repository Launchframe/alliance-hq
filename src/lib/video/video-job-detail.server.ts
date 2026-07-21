import "server-only";

import { and, count, desc, eq } from "drizzle-orm";

import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { getDb, schema } from "@/lib/db";
import {
  getExtractionPassComparison,
  getRosterTesseractEvalComparison,
} from "@/lib/video/group-comparisons.shared";

export type VideoJobDetailPayload = {
  job: {
    uploadedBy: string | null;
    timingsJson: VideoProcessTimings | null;
  } & (typeof schema.videoJobs.$inferSelect);
  frames: Array<{
    frameIndex: number;
    uploadMs: number | null;
    extractMs: number | null;
    ocrEntryCount: number | null;
    ocrError: string | null;
    ocrRawJson: unknown;
    videoTimestampSeconds: number | null;
  }>;
  parsedRows: Array<{
    id: string;
    ocrName: string;
    score: string | null;
    scoreConflict: number;
    memberName: string | null;
    matchConfidence: number | null;
    deleted: number;
    edited: number;
    manuallyAdded: number;
  }>;
  editCount: number;
  deleteCount: number;
  addCount: number;
  sameFileResubmits: number;
  survey: {
    rowCountEstimate: number | null;
    scrollStyle: string | null;
    aboveAverageScroll: boolean | null;
    schoolingTuitionAnswer: string | null;
  } | null;
  groupPasses: Array<{
    id: string;
    passKey: string | null;
    passRole: string | null;
    status: string;
  }>;
  groupInfo: {
    selectedJobId: string | null;
    accuracyJobId: string | null;
    recommendedJobId: string | null;
  } | null;
  rosterTesseractEval: unknown;
};

export async function loadVideoJobDetail(
  jobId: string,
): Promise<VideoJobDetailPayload | null> {
  const db = getDb();

  const [row] = await db
    .select({
      job: schema.videoJobs,
      uploaderName: schema.hqUsers.displayName,
      uploaderEmail: schema.hqUsers.email,
    })
    .from(schema.videoJobs)
    .leftJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.videoJobs.enqueuedByHqUserId),
    )
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!row) {
    return null;
  }

  const { job } = row;
  let uploadedBy = row.uploaderName ?? row.uploaderEmail ?? null;

  if (!uploadedBy && job.hqUserId) {
    const [uploader] = await db
      .select({
        displayName: schema.hqUsers.displayName,
        email: schema.hqUsers.email,
      })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, job.hqUserId))
      .limit(1);
    uploadedBy = uploader?.displayName ?? uploader?.email ?? null;
  }

  const frames = await db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      uploadMs: schema.videoFrames.uploadMs,
      extractMs: schema.videoFrames.extractMs,
      ocrEntryCount: schema.videoFrames.ocrEntryCount,
      ocrError: schema.videoFrames.ocrError,
      ocrRawJson: schema.videoFrames.ocrRawJson,
      videoTimestampSeconds: schema.videoFrames.videoTimestampSeconds,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, jobId))
    .orderBy(schema.videoFrames.frameIndex);

  let parsedRows: VideoJobDetailPayload["parsedRows"] = [];

  if (job.parseSessionId) {
    parsedRows = await db
      .select({
        id: schema.parsedRows.id,
        ocrName: schema.parsedRows.ocrName,
        score: schema.parsedRows.score,
        scoreConflict: schema.parsedRows.scoreConflict,
        memberName: schema.parsedRows.memberName,
        matchConfidence: schema.parsedRows.matchConfidence,
        deleted: schema.parsedRows.deleted,
        edited: schema.parsedRows.edited,
        manuallyAdded: schema.parsedRows.manuallyAdded,
      })
      .from(schema.parsedRows)
      .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId))
      .orderBy(desc(schema.parsedRows.createdAt));
  }

  const editCount = parsedRows.filter((r) => r.edited === 1).length;
  const deleteCount = parsedRows.filter((r) => r.deleted === 1).length;
  const addCount = parsedRows.filter((r) => r.manuallyAdded === 1).length;

  let sameFileResubmits = 0;
  if (job.fileName && job.hqUserId) {
    const [countRow] = await db
      .select({ count: count() })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.fileName, job.fileName),
          eq(schema.videoJobs.hqUserId, job.hqUserId),
          eq(schema.videoJobs.status, "complete"),
        ),
      );
    sameFileResubmits = countRow?.count ?? 0;
  }

  const [surveyRow] = await db
    .select({
      rowCountEstimate: schema.videoJobSurveys.rowCountEstimate,
      scrollStyle: schema.videoJobSurveys.scrollStyle,
      aboveAverageScroll: schema.videoJobSurveys.aboveAverageScroll,
      schoolingTuitionAnswer: schema.videoJobSurveys.schoolingTuitionAnswer,
    })
    .from(schema.videoJobSurveys)
    .where(eq(schema.videoJobSurveys.jobId, jobId))
    .limit(1);

  let groupPasses: VideoJobDetailPayload["groupPasses"] = [];
  let groupInfo: VideoJobDetailPayload["groupInfo"] = null;
  let rosterTesseractEval: unknown = null;

  if (job.groupId) {
    groupPasses = await db
      .select({
        id: schema.videoJobs.id,
        passKey: schema.videoJobs.passKey,
        passRole: schema.videoJobs.passRole,
        status: schema.videoJobs.status,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.groupId, job.groupId));

    const [group] = await db
      .select({
        selectedJobId: schema.videoUploadGroups.selectedJobId,
        accuracyJobId: schema.videoUploadGroups.accuracyJobId,
        comparisonJson: schema.videoUploadGroups.comparisonJson,
      })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);

    if (group) {
      const extractionComparison = getExtractionPassComparison(
        group.comparisonJson,
      );
      groupInfo = {
        selectedJobId: group.selectedJobId ?? null,
        accuracyJobId: group.accuracyJobId ?? null,
        recommendedJobId: extractionComparison?.recommendedJobId ?? null,
      };
      rosterTesseractEval = getRosterTesseractEvalComparison(
        group.comparisonJson,
      );
    }
  }

  return {
    job: {
      ...job,
      uploadedBy,
      timingsJson: (job.timingsJson as VideoProcessTimings | null) ?? null,
    },
    frames,
    parsedRows,
    editCount,
    deleteCount,
    addCount,
    sameFileResubmits,
    survey: surveyRow ?? null,
    groupPasses,
    groupInfo,
    rosterTesseractEval,
  };
}
