import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { jobId } = await params;
  const db = getDb();
  const [job] = await db
    .select({ id: schema.videoJobs.id })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, jobId))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  await db
    .update(schema.videoJobs)
    .set({
      status: "queued",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.videoJobs.id, jobId));

  await dispatchVideoProcessing(jobId, { source: "admin-requeue" });

  return NextResponse.json({ ok: true, jobId, status: "queued" });
}
