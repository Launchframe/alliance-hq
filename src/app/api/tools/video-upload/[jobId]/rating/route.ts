import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

export async function PATCH(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const body = (await request.json()) as { rating?: string; ratingReason?: string };
  const rating = body.rating;
  if (rating !== "thumbs_up" && rating !== "thumbs_down") {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }
  const ratingReason =
    typeof body.ratingReason === "string" ? body.ratingReason : null;
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

  await db
    .update(schema.videoJobs)
    .set({ rating, ratingAt: new Date(), ratingReason })
    .where(eq(schema.videoJobs.id, jobId));

  return NextResponse.json({ ok: true });
}
