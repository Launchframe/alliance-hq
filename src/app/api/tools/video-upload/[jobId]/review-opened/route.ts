import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
import { markVideoJobReviewOpened } from "@/lib/video/video-hygiene-instrumentation.server";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = { params: Promise<{ jobId: string }> };

/** Idempotently record the first open of the review UI for latency metrics. */
export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const access = await resolveVideoJobAccess(jobId, session.id, "read");
  if (!access.ok) {
    return videoJobAccessErrorResponse(access);
  }

  const result = await markVideoJobReviewOpened(jobId);
  return NextResponse.json({
    ok: true,
    opened: result.opened,
    reviewOpenedAt: result.reviewOpenedAt?.toISOString() ?? null,
  });
}
