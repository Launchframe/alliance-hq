import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { buildConnectHref } from "@/lib/connect/connect-return-path.shared";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { loadEffectiveAllianceHqOcrOnly } from "@/lib/video/alliance-ocr-settings.server";
import {
  engineRequiresAshed,
  resolveVideoOcrEngineForJob,
} from "@/lib/video/ocr-provider.shared";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import {
  canReprocessVideoJob,
  videoJobReprocessInFlightMessage,
} from "@/lib/video/admin-job-actions";
import {
  resetVideoJobForReprocess,
  VideoJobReprocessConflictError,
} from "@/lib/video/reset-video-job-for-reprocess";
import {
  isMemberRosterVideoTarget,
  isNativeOnlyVideoTarget,
} from "@/lib/video/score-targets";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";

type Props = {
  params: Promise<{ jobId: string }>;
};

/**
 * Re-run OCR for a job the processor can access.
 * Mirrors approve: native-only targets skip Ashed; processing is dispatched
 * asynchronously so the review UI can follow SSE queued → review transitions.
 */
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

    if (!canReprocessVideoJob(job.status)) {
      return NextResponse.json(
        { error: videoJobReprocessInFlightMessage(job.status) },
        { status: 409 },
      );
    }

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const reviewPath = `/tools/video-upload/${jobId}/review`;
    const allianceId = job.allianceId ?? session.currentAllianceId;
    const hqOcrOnly = allianceId
      ? await loadEffectiveAllianceHqOcrOnly(allianceId)
      : false;
    const ocrEngine = resolveVideoOcrEngineForJob(
      scoreTargetId,
      isMemberRosterVideoTarget(scoreTargetId),
      { allianceHqOcrOnly: hqOcrOnly },
      { forceNative: isNativeOnlyVideoTarget(scoreTargetId) },
    );

    if (engineRequiresAshed(ocrEngine)) {
      const connection = await getAshedConnection(session.id);
      if (!connection) {
        return NextResponse.json(
          {
            error: "Connect Ashed to process videos.",
            code: "ashed_not_connected",
            connectUrl: buildConnectHref(reviewPath),
          },
          { status: 409 },
        );
      }
    }

    // Claim queued and bind processor session atomically so dispatch cannot
    // observe stale processingSessionId between reset and approval fields.
    const approvedAt = new Date();
    await resetVideoJobForReprocess(jobId, {
      processorBinding: {
        processingSessionId: session.id,
        approvedByHqUserId: session.hqUserId,
        approvedAt,
      },
    });

    await writeAuditLog({
      sessionId: session.id,
      allianceId: job.allianceId,
      action: "video.reprocess",
      resourceType: "video_job",
      resourceName: scoreTargetId,
      resourceId: jobId,
      metadata: { enqueuedByHqUserId: job.enqueuedByHqUserId },
    });

    dispatchVideoProcessing(jobId, { source: "reprocess" });

    return NextResponse.json({ ok: true, jobId, status: "queued" });
  } catch (error) {
    if (error instanceof VideoJobReprocessConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reprocess failed",
      },
      { status: 500 },
    );
  }
}
