import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

type SurveyBody = {
  rowCountEstimate?: number | null;
  scrollStyle?: string | null;
  aboveAverageScroll?: boolean | null;
};

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const body = (await request.json()) as SurveyBody;

    const db = getDb();

    // Verify job ownership
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
    await db.insert(schema.videoJobSurveys).values({
      id: nanoid(16),
      jobId,
      rowCountEstimate:
        typeof body.rowCountEstimate === "number" ? body.rowCountEstimate : null,
      scrollStyle:
        typeof body.scrollStyle === "string" ? body.scrollStyle : null,
      aboveAverageScroll:
        typeof body.aboveAverageScroll === "boolean"
          ? body.aboveAverageScroll
          : null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Survey save failed" },
      { status: 500 },
    );
  }
}
