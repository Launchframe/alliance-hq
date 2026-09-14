import "server-only";

import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { VideoJob } from "@/lib/db/schema";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { commitReviewedVsScores, type VsReviewRow } from "./repository.server";
import { VsEvidenceError } from "./evidence.shared";
import { syncVsScoresForAlliance } from "./sync.server";
import { getSolicitedEligibility } from "@/lib/feedback/solicited-eligibility";
import { notifyEurVideoEvidence } from "@/lib/eur/satisfaction";
import { announcePriceIsRightLeaderboardAfterVsUpload } from "@/lib/trains/price-is-right-leaderboard-discord.server";
import { maybeNominateConductorAfterVsUpload } from "@/lib/trains/conductor-confirmation.server";

import { vsEvidenceErrorResponse } from "./errors.server";
export { vsEvidenceErrorResponse } from "./errors.server";

export async function submitVsReview(input: {
  sessionId: string; hqUserId: string | null; job: VideoJob;
  automaticDeletedIds?: readonly string[];
  body: { recordedDate?: string; vsPeriod?: string; vsRevision?: number; requestId?: string; ocrFeedbackVersion?: number; rows: VsReviewRow[] };
}) {
  const period = input.body.vsPeriod === "weekly" ? "weekly" : "daily";
  try {
    if (!input.hqUserId) throw new VsEvidenceError("forbidden", 403);
    if (input.body.vsPeriod != null && input.body.vsPeriod !== "daily" && input.body.vsPeriod !== "weekly") throw new VsEvidenceError("invalid_period");
    const allianceId = await resolveHqAllianceIdFromStoredAllianceId(input.job.allianceId);
    if (!allianceId) throw new VsEvidenceError("forbidden", 403);
    const denied = await requireAlliancePermission(input.sessionId, allianceId, "scores:write");
    if (denied) return denied;
    const requestId = input.body.requestId ?? createHash("sha256").update(JSON.stringify([input.job.id, input.body.vsRevision ?? 0, input.body])).digest("hex");
    const result = await commitReviewedVsScores({
      allianceId, hqUserId: input.hqUserId, jobId: input.job.id, parseSessionId: input.job.parseSessionId,
      recordedDate: input.body.recordedDate ?? "", period, rows: input.body.rows,
      expectedRevision: input.body.vsRevision, requestId, automaticDeletedIds: input.automaticDeletedIds, humanDeletesKnown: input.body.ocrFeedbackVersion === 1,
    });
    after(async () => {
      await Promise.allSettled([
        emitVideoJobStatus({ ...videoJobStatusOwnerFields(input.job), jobId: input.job.id, status: "complete", fileName: input.job.fileName, scoreTarget: "vs-performance", errorMessage: null }),
        notifyEurVideoEvidence(allianceId),
        announcePriceIsRightLeaderboardAfterVsUpload({ allianceId, vsRecordedDate: input.body.recordedDate! }),
        maybeNominateConductorAfterVsUpload({ allianceId, vsRecordedDate: input.body.recordedDate! }),
        syncVsScoresForAlliance(allianceId),
      ]);
    });
    const feedback = await getSolicitedEligibility({ hqUserId: input.hqUserId, videoJobId: input.job.id }).catch(() => ({ showSolicitedFeedback: false, completedUploadCount: 0 }));
    return NextResponse.json({ ok: true, ...result, storage: "hq", ...feedback });
  } catch (error) { return vsEvidenceErrorResponse(error, period); }
}
