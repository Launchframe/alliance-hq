import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import { vsErrorResponse } from "@/lib/vs-performance/api-helpers.server";
import {
  loadVsVideoEvidence,
  requeueVsVideoEvidence,
  resolveVsVideoAccess,
  vsVideoJobReadyForEvidence,
} from "@/lib/vs-performance/video-evidence.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Props = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    if (!session.hqUserId) throw new VsPerformanceError("forbidden", 403);
    const { jobId } = await params;
    const access = await resolveVsVideoAccess(session.id, jobId, "review");
    if (!vsVideoJobReadyForEvidence(access.job)) {
      throw new VsPerformanceError("stale", 409);
    }
    await requeueVsVideoEvidence(access);
    const { processVsVideoEvidence } = await import(
      "@/lib/vs-performance/video-evidence-process.server"
    );
    await processVsVideoEvidence(jobId, access.actor);
    const response = await loadVsVideoEvidence(access);
    const { writeTrainsOfficerAudit } = await import(
      "@/lib/bff/officer-action-audit.server"
    );
    await writeTrainsOfficerAudit({
      sessionId: access.actor.sessionId,
      allianceId: access.actor.allianceId,
      hqUserId: access.actor.hqUserId,
      action: "vs.video_capture_process",
      severity: "update",
      resourceType: "video_job",
      resourceId: access.job.id,
      metadata: {
        version: response.evidence.version,
        imageVersion: response.evidence.imageVersion,
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    return vsErrorResponse(error);
  }
}
