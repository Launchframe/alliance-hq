import { NextResponse } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";

import type { VideoProcessTimings } from "@/lib/analytics/video-pipeline";
import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type RouteParams = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId } = await params;
  const db = getDb();

  const [job] = await db
    .select()
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const frames = await db
    .select({
      frameIndex: schema.videoFrames.frameIndex,
      uploadMs: schema.videoFrames.uploadMs,
      extractMs: schema.videoFrames.extractMs,
      ocrEntryCount: schema.videoFrames.ocrEntryCount,
      ocrError: schema.videoFrames.ocrError,
      ocrRawJson: schema.videoFrames.ocrRawJson,
    })
    .from(schema.videoFrames)
    .where(eq(schema.videoFrames.jobId, jobId))
    .orderBy(schema.videoFrames.frameIndex);

  let parsedRows: Array<{
    id: string;
    ocrName: string;
    score: string;
    scoreConflict: number;
    memberName: string | null;
    matchConfidence: number | null;
    deleted: number;
    edited: number;
    manuallyAdded: number;
  }> = [];

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

  const editCount = parsedRows.filter((row) => row.edited === 1).length;
  const deleteCount = parsedRows.filter((row) => row.deleted === 1).length;
  const addCount = parsedRows.filter((row) => row.manuallyAdded === 1).length;

  let sameFileResubmits = 0;
  if (job.fileName && job.hqUserId) {
    const [row] = await db
      .select({ count: count() })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.fileName, job.fileName),
          eq(schema.videoJobs.hqUserId, job.hqUserId),
          eq(schema.videoJobs.status, "complete"),
        ),
      );
    sameFileResubmits = row?.count ?? 0;
  }

  let survey: {
    rowCountEstimate: number | null;
    scrollStyle: string | null;
    aboveAverageScroll: boolean | null;
    schoolingTuitionAnswer: string | null;
  } | null = null;

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

  survey = surveyRow ?? null;

  let groupPasses: Array<{
    id: string;
    passKey: string | null;
    passRole: string | null;
    status: string;
  }> = [];

  let groupInfo: {
    selectedJobId: string | null;
    accuracyJobId: string | null;
    recommendedJobId: string | null;
  } | null = null;

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
      const comp = group.comparisonJson as { recommendedJobId?: string | null } | null;
      groupInfo = {
        selectedJobId: group.selectedJobId ?? null,
        accuracyJobId: group.accuracyJobId ?? null,
        recommendedJobId: comp?.recommendedJobId ?? null,
      };
    }
  }

  return NextResponse.json({
    job: {
      ...job,
      timingsJson: (job.timingsJson as VideoProcessTimings | null) ?? null,
    },
    frames,
    parsedRows,
    editCount,
    deleteCount,
    addCount,
    sameFileResubmits,
    survey,
    groupPasses,
    groupInfo,
  });
}
