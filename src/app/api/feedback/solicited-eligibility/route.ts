import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { getSolicitedEligibility } from "@/lib/feedback/solicited-eligibility";
import { getOrCreateSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const videoJobId = searchParams.get("videoJobId");
    if (!videoJobId) {
      return NextResponse.json(
        { error: "videoJobId is required" },
        { status: 400 },
      );
    }

    const db = getDb();
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(
        and(
          eq(schema.videoJobs.id, videoJobId),
          eq(schema.videoJobs.sessionId, session.id),
        ),
      )
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const eligibility = await getSolicitedEligibility({
      hqUserId: session.hqUserId,
      videoJobId,
    });

    return NextResponse.json(eligibility);
  } catch {
    return feedbackErrorResponse("Eligibility check failed");
  }
}
