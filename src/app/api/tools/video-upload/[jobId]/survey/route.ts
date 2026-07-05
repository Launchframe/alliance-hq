import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import {
  accumulatedFromPayload,
  hasSurveyAnswers,
  isSurveyComplete,
  mergeSurveyPayload,
  parseSurveyBody,
  surveyResumeStep,
  surveyRowToPayload,
} from "@/lib/video/survey";
import { resolveVideoJobUploaderAccess } from "@/lib/video/video-job-access.server";

type Props = { params: Promise<{ jobId: string }> };

async function loadOwnedJob(jobId: string, sessionId: string) {
  const access = await resolveVideoJobUploaderAccess(jobId, sessionId);
  if (!access.ok) {
    return null;
  }
  return { id: access.job.id };
}

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    const job = await loadOwnedJob(jobId, session.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const db = getDb();
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

    const payload = surveyRow ? surveyRowToPayload(surveyRow) : null;

    return NextResponse.json({
      survey: payload,
      complete: isSurveyComplete(payload),
      resumeStep: surveyResumeStep(payload),
      accumulated: payload ? accumulatedFromPayload(payload) : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Survey load failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const payload = parseSurveyBody(body);

    if (!hasSurveyAnswers(payload)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const db = getDb();

    const job = await loadOwnedJob(jobId, session.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [existingRow] = await db
      .select({
        rowCountEstimate: schema.videoJobSurveys.rowCountEstimate,
        scrollStyle: schema.videoJobSurveys.scrollStyle,
        aboveAverageScroll: schema.videoJobSurveys.aboveAverageScroll,
        schoolingTuitionAnswer: schema.videoJobSurveys.schoolingTuitionAnswer,
      })
      .from(schema.videoJobSurveys)
      .where(eq(schema.videoJobSurveys.jobId, jobId))
      .limit(1);

    const merged = mergeSurveyPayload(
      existingRow ? surveyRowToPayload(existingRow) : null,
      payload,
    );

    const now = new Date();
    await db
      .insert(schema.videoJobSurveys)
      .values({
        id: nanoid(16),
        jobId,
        rowCountEstimate: merged.rowCountEstimate,
        scrollStyle: merged.scrollStyle,
        aboveAverageScroll: merged.aboveAverageScroll,
        schoolingTuitionAnswer: merged.schoolingTuitionAnswer,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.videoJobSurveys.jobId,
        set: {
          rowCountEstimate: merged.rowCountEstimate,
          scrollStyle: merged.scrollStyle,
          aboveAverageScroll: merged.aboveAverageScroll,
          schoolingTuitionAnswer: merged.schoolingTuitionAnswer,
          updatedAt: now,
        },
      });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Survey save failed" },
      { status: 500 },
    );
  }
}
