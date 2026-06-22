import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import { resetVideoJobForReprocess } from "@/lib/video/process-job";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  try {
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

    await resetVideoJobForReprocess(jobId);
    dispatchVideoProcessing(jobId, { source: "reprocess" });

    return NextResponse.json({
      ok: true,
      jobId,
      status: "queued",
      message: "OCR re-run queued. This page updates when processing finishes.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reprocess failed",
      },
      { status: 500 },
    );
  }
}
