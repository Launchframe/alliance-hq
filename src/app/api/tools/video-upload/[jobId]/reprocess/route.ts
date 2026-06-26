import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import {
  processVideoJob,
  resetVideoJobForReprocess,
} from "@/lib/video/process-job";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const db = getDb();

    if (!(await sessionCanProcessVideo(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (
      session.currentAllianceId &&
      job.allianceId &&
      job.allianceId !== session.currentAllianceId
    ) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const connection = await getAshedConnection(session.id);
    if (!connection) {
      return NextResponse.json(
        {
          error: "Connect Ashed to process videos.",
          code: "ashed_not_connected",
          connectUrl: "/connect",
        },
        { status: 409 },
      );
    }

    // Rebind OCR to the reprocessing processor's credential.
    await db
      .update(schema.videoJobs)
      .set({
        processingSessionId: session.id,
        approvedByHqUserId: session.hqUserId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.videoJobs.id, jobId));

    await resetVideoJobForReprocess(jobId);
    const timings = await processVideoJob(jobId);

    return NextResponse.json({ ok: true, jobId, status: "review", timings });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reprocess failed",
      },
      { status: 500 },
    );
  }
}
