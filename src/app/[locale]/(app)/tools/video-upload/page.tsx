import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { VideoUploadForm } from "@/components/VideoUploadForm";
import { verifyBase44Connection } from "@/lib/base44/server";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, requirePageSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import type { VideoJobRow } from "@/lib/types/video";
import {
  jobMatchesScoreTarget,
  parseVideoUploadBankIdParam,
  parseVideoUploadBoardKeyParam,
  parseVideoUploadScoreTargetParam,
} from "@/lib/video/score-target-nav";
import { resolveSurveyPlayerNameFromSources } from "@/lib/video/survey-player-name";
import { isSurveyComplete, surveyRowToPayload } from "@/lib/video/survey";
import { videoJobsOwnedByViewerWhere } from "@/lib/video/video-job-ownership.server";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    scoreTarget?: string;
    bankId?: string;
    boardKey?: string;
  }>;
};

async function resolveSurveyMemberName(
  sessionId: string,
  hqUserId: string | null,
): Promise<string | null> {
  const db = getDb();
  let displayName: string | null = null;

  if (hqUserId) {
    const [user] = await db
      .select({ displayName: schema.hqUsers.displayName })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.id, hqUserId))
      .limit(1);
    displayName = user?.displayName ?? null;
  }

  const connection = await getAshedConnection(sessionId);
  if (!connection) {
    return resolveSurveyPlayerNameFromSources(null, displayName);
  }

  try {
    const me = await verifyBase44Connection(connection);
    return resolveSurveyPlayerNameFromSources(me.full_name, displayName);
  } catch {
    return resolveSurveyPlayerNameFromSources(null, displayName);
  }
}

export default async function VideoUploadPage({ searchParams }: Props) {
  const { scoreTarget: scoreTargetParam, bankId: bankIdParam, boardKey: boardKeyParam } =
    await searchParams;
  const contextScoreTarget = parseVideoUploadScoreTargetParam(scoreTargetParam);
  const contextBankId = parseVideoUploadBankIdParam(bankIdParam);
  const contextBoardKey = parseVideoUploadBoardKeyParam(
    boardKeyParam,
    contextScoreTarget,
  );
  const session = await requirePageSession();
  const db = getDb();
  const [rows, memberName, canProcess, ashedConnection] = await Promise.all([
    db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          videoJobsOwnedByViewerWhere(session.id, session.hqUserId),
          ne(schema.videoJobs.status, "discarded"),
          ne(schema.videoJobs.status, "pending_upload"),
          or(
            eq(schema.videoJobs.passRole, "primary"),
            isNull(schema.videoJobs.passRole),
          ),
        ),
      )
      .orderBy(desc(schema.videoJobs.createdAt)),
    resolveSurveyMemberName(session.id, session.hqUserId),
    sessionCanProcessVideo(session.id),
    getAshedConnection(session.id),
  ]);

  const jobIds = rows.map((job) => job.id);
  const surveyRows =
    jobIds.length > 0
      ? await db
          .select({
            jobId: schema.videoJobSurveys.jobId,
            rowCountEstimate: schema.videoJobSurveys.rowCountEstimate,
            scrollStyle: schema.videoJobSurveys.scrollStyle,
            aboveAverageScroll: schema.videoJobSurveys.aboveAverageScroll,
            schoolingTuitionAnswer: schema.videoJobSurveys.schoolingTuitionAnswer,
          })
          .from(schema.videoJobSurveys)
          .where(inArray(schema.videoJobSurveys.jobId, jobIds))
      : [];
  const surveyByJobId = new Map(surveyRows.map((row) => [row.jobId, row]));

  const filteredRows = contextScoreTarget
    ? rows.filter((job) =>
        jobMatchesScoreTarget(
          {
            scoreTarget: job.scoreTarget,
            category: job.category,
          },
          contextScoreTarget,
        ),
      )
    : rows;

  const initialJobs: VideoJobRow[] = filteredRows.map((job) => {
    const surveyRow = surveyByJobId.get(job.id);
    const surveyPayload = surveyRow ? surveyRowToPayload(surveyRow) : null;
    return {
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
      surveyComplete: isSurveyComplete(surveyPayload),
    };
  });

  let allianceTag: string | null = session.allianceTag;
  let allianceName: string | null = null;
  const hqAllianceId = session.currentAllianceId ?? session.allianceId;
  if (hqAllianceId) {
    const [allianceRow] = await db
      .select({
        tag: schema.alliances.tag,
        name: schema.alliances.name,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, hqAllianceId))
      .limit(1);
    if (allianceRow?.tag) {
      allianceTag = allianceRow.tag.trim();
    }
    allianceName = allianceRow?.name ?? null;
  }

  return (
    <VideoUploadForm
      initialJobs={initialJobs}
      memberName={memberName}
      contextScoreTarget={contextScoreTarget}
      contextBankId={contextBankId}
      contextBoardKey={contextBoardKey}
      allianceTag={allianceTag}
      allianceName={allianceName}
      canProcess={canProcess}
      ashedConnected={Boolean(ashedConnection)}
      connectUrl={`/connect?next=${encodeURIComponent("/tools/video-upload")}`}
    />
  );
}
