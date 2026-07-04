import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { getDb, schema } from "@/lib/db";
import { assignRosterOcrExperiment } from "@/lib/members/roster-ocr/assign-roster-config";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { loadEffectiveAllianceHqOcrOnly } from "@/lib/video/alliance-ocr-settings.server";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import {
  resolveVideoOcrEngineForJob,
  engineRequiresAshed,
} from "@/lib/video/ocr-provider.shared";
import { dispatchVideoProcessing } from "@/lib/video/trigger-processing";
import { isMemberRosterVideoTarget } from "@/lib/video/score-targets";

type Props = {
  params: Promise<{ jobId: string }>;
};

/**
 * A video processor approves a pending job to run OCR. Binds the approver's
 * Ashed credential to the job (processingSessionId) and dispatches processing.
 * Returns 409 ashed_not_connected (not 500) when the processor has no live
 * Ashed credential, leaving the job pending so they can connect and retry.
 */
export async function POST(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    if (!(await sessionCanProcessVideo(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = getDb();
    const [job] = await db
      .select()
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Tenant isolation: only process jobs uploaded within the current alliance.
    if (
      session.currentAllianceId &&
      job.allianceId &&
      job.allianceId !== session.currentAllianceId
    ) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Only pending jobs can be approved." },
        { status: 409 },
      );
    }

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const allianceId = job.allianceId ?? session.currentAllianceId;
    const hqOcrOnly = allianceId
      ? await loadEffectiveAllianceHqOcrOnly(allianceId)
      : false;
    const ocrContext = { allianceHqOcrOnly: hqOcrOnly };
    const ocrEngine = resolveVideoOcrEngineForJob(
      scoreTargetId,
      isMemberRosterVideoTarget(scoreTargetId),
      ocrContext,
    );

    if (engineRequiresAshed(ocrEngine)) {
      const connection = await getAshedConnection(session.id);
      if (!connection) {
        return NextResponse.json(
          {
            error: "Connect Ashed to process videos.",
            code: "ashed_not_connected",
            connectUrl: `/connect?next=${encodeURIComponent("/tools/video-upload/queue")}`,
          },
          { status: 409 },
        );
      }
    }

    // For native engine (local/mock primary mode) on roster targets, stamp the
    // experiment-assigned passKey + config onto the job row so the OCR pass
    // uses the tunable config and the job detail shows which knobs ran.
    let nativeConfigPatch: {
      passKey?: string | null;
      extractionConfigJson?: unknown;
    } = {};
    if (
      (ocrEngine === "native" || ocrEngine === "mock") &&
      isMemberRosterVideoTarget(scoreTargetId) &&
      !job.passKey
    ) {
      const assignment = await assignRosterOcrExperiment();
      nativeConfigPatch = {
        passKey: assignment.passKey ?? null,
        extractionConfigJson: assignment.config,
      };
    }

    const now = new Date();
    await db
      .update(schema.videoJobs)
      .set({
        status: "queued",
        processingSessionId: session.id,
        approvedByHqUserId: session.hqUserId,
        approvedAt: now,
        errorMessage: null,
        updatedAt: now,
        ...nativeConfigPatch,
      })
      .where(eq(schema.videoJobs.id, jobId));

    await writeAuditLog({
      sessionId: session.id,
      allianceId: job.allianceId,
      action: "video.approve",
      resourceType: "video_job",
      resourceName: job.scoreTarget ?? job.category,
      resourceId: jobId,
      metadata: { enqueuedByHqUserId: job.enqueuedByHqUserId },
    });

    // Notify the uploader's live session that processing has started.
    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "queued",
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      frameCount: null,
      uploadedFrameCount: 0,
      errorMessage: null,
    });

    dispatchVideoProcessing(jobId, { source: "approve" });

    return NextResponse.json({ ok: true, jobId, status: "queued" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Approve failed" },
      { status: 500 },
    );
  }
}
