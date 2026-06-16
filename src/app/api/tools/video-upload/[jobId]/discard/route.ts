import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

export async function PATCH(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const db = getDb();

  const [job] = await db
    .select()
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

  if (job.status !== "review") {
    return NextResponse.json(
      { error: "Only jobs awaiting review can be discarded." },
      { status: 400 },
    );
  }

  await db
    .update(schema.videoJobs)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(eq(schema.videoJobs.id, jobId));

  await emitVideoJobStatus({
    sessionId: session.id,
    jobId,
    status: "discarded",
    fileName: job.fileName,
    scoreTarget: job.scoreTarget ?? job.category,
    errorMessage: null,
  });

  return NextResponse.json({ ok: true });
}
