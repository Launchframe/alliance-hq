import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import { hasSurveyAnswers, parseSurveyBody } from "@/lib/video/survey";

type Props = { params: Promise<{ jobId: string }> };

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

    const [job] = await db
      .select({ id: schema.videoJobs.id })
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.id, jobId),
          eq(schema.videoJobs.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const now = new Date();
    await db
      .insert(schema.videoJobSurveys)
      .values({
        id: nanoid(16),
        jobId,
        rowCountEstimate: payload.rowCountEstimate,
        scrollStyle: payload.scrollStyle,
        aboveAverageScroll: payload.aboveAverageScroll,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.videoJobSurveys.jobId,
        set: {
          rowCountEstimate: payload.rowCountEstimate,
          scrollStyle: payload.scrollStyle,
          aboveAverageScroll: payload.aboveAverageScroll,
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
