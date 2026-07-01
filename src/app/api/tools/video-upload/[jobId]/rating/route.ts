import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

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

  const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
  if (!access.ok) {
    return videoJobAccessErrorResponse(access);
  }

  await db
    .update(schema.videoJobs)
    .set({ rating, ratingAt: new Date(), ratingReason })
    .where(eq(schema.videoJobs.id, jobId));

  return NextResponse.json({ ok: true });
}
