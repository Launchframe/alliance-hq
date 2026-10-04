import "server-only";

import { NextResponse } from "next/server";

import type { VideoJob } from "@/lib/db/schema";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import {
  commitFrontlineReview,
  FrontlineReviewError,
  type FrontlineSubmitBody,
} from "@/lib/video/frontline-results.server";

export function frontlineErrorResponse(error: unknown): NextResponse {
  if (error instanceof FrontlineReviewError) {
    return NextResponse.json(
      { code: error.code, error: error.code, issues: error.issues },
      { status: error.status },
    );
  }
  console.error("[frontline-submit] save failed", error);
  return NextResponse.json(
    { code: "frontlineSaveFailed", error: "frontlineSaveFailed", issues: [] },
    { status: 500 },
  );
}

export async function submitFrontlineReview(input: {
  sessionId: string;
  hqUserId: string | null;
  job: VideoJob;
  body: FrontlineSubmitBody;
}): Promise<NextResponse> {
  try {
    if (!input.hqUserId) {
      throw new FrontlineReviewError("frontlineSaveFailed", 403);
    }
    const allianceId = await resolveHqAllianceIdFromStoredAllianceId(
      input.job.allianceId,
    );
    if (!allianceId) {
      throw new FrontlineReviewError("frontlineSaveFailed", 403);
    }
    const denied = await requireAlliancePermission(
      input.sessionId,
      allianceId,
      "scores:write",
    );
    if (denied) return denied;

    const result = await commitFrontlineReview({
      job: input.job,
      allianceId,
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      body: input.body,
    });

    void emitVideoJobStatus({
      ...videoJobStatusOwnerFields(input.job),
      jobId: input.job.id,
      status: "complete",
      fileName: input.job.fileName,
      scoreTarget: "frontline-breakthrough",
      errorMessage: null,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      storage: "hq",
      submitted: result.submitted,
    });
  } catch (error) {
    return frontlineErrorResponse(error);
  }
}
