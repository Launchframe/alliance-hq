import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { VideoUploadForm } from "@/components/VideoUploadForm";
import { verifyBase44Connection } from "@/lib/base44/server";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, requirePageSession } from "@/lib/session";
import type { VideoJobRow } from "@/lib/types/video";
import { resolveSurveyPlayerNameFromSources } from "@/lib/video/survey-player-name";
import { isSurveyComplete, surveyRowToPayload } from "@/lib/video/survey";

export const dynamic = "force-dynamic";

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

export default async function VideoUploadPage() {
  const session = await requirePageSession();
  const db = getDb();
  const [rows, memberName] = await Promise.all([
    db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.sessionId, session.id),
          ne(schema.videoJobs.status, "discarded"),
        ),
      )
      .orderBy(desc(schema.videoJobs.createdAt)),
    resolveSurveyMemberName(session.id, session.hqUserId),
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

  const initialJobs: VideoJobRow[] = rows.map((job) => {
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

  return <VideoUploadForm initialJobs={initialJobs} memberName={memberName} />;
}
