import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { getDb, schema } from "@/lib/db";
import { base44EntityPost } from "@/lib/base44/fetch";
import {
  resolveAshedEventId,
  upsertHqEventMemberMetadata,
} from "@/lib/hq-events/provision-ashed";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { commitRosterFromVideoJob } from "@/lib/members/roster-video-commit";
import { listAllianceMembers } from "@/lib/members/roster.server";
import {
  computeProjectedRosterRankCounts,
  validateRosterRankQuota,
} from "@/lib/members/roster-rank-quota.shared";
import { formatHeroPowerMForStorage } from "@/lib/video/roster-video-review.shared";
import { getRbacContext } from "@/lib/rbac/context";
import { findDuplicateMemberAssignments } from "@/lib/video/review-validation";
import {
  getScoreTargetOrThrow,
  isMemberRosterVideoTarget,
  usesHqEventStore,
} from "@/lib/video/score-targets";
import {
  getSolicitedEligibility,
} from "@/lib/feedback/solicited-eligibility";
import { dispatchScoreSubmit } from "@/lib/video/submit-dispatch";
import { notifyEurVideoEvidence } from "@/lib/eur/satisfaction";
import { announcePriceIsRightLeaderboardAfterVsUpload } from "@/lib/trains/price-is-right-leaderboard-discord.server";
import { buildAshedEventProvisionBody } from "@/lib/video/ashed-event-provision";
import {
  buildSubmitPayloads,
  validateSubmitContext,
  type SubmitContext,
} from "@/lib/video/submit-schemas";
import { computeQualityScore } from "@/lib/video/quality-score";
import {
  isVideoJobReadyForSubmit,
  VIDEO_SUBMIT_IN_PROGRESS_ERROR,
  VIDEO_SUBMIT_READY_STATUSES,
  videoSubmitClaimLostError,
  videoSubmitNotReadyError,
} from "@/lib/video/submit-job-ready.shared";

type Props = {
  params: Promise<{ jobId: string }>;
};

type SubmitRow = {
  id: string;
  memberId?: string | null;
  memberName?: string | null;
  score?: string;
  rank?: number | null;
  allianceRank?: number | null;
  heroPowerM?: number | null;
  memberLevel?: number | null;
  profession?: string | null;
  deleted?: boolean;
};

type SubmitBody = {
  eventId?: string;
  team?: "A" | "B";
  recordedDate: string;
  hqEventId?: string;
  boardKey?: string;
  commendationId?: string;
  rows: SubmitRow[];
};

type ClaimVideoJobForSubmitResult =
  | { ok: true }
  | {
      ok: false;
      httpStatus: 400 | 409;
      error: string;
      jobStatus: string;
    };

/** Atomically claim review/complete → submitting so two devices cannot double-submit. */
async function claimVideoJobForSubmit(
  db: ReturnType<typeof getDb>,
  jobId: string,
  currentStatus: string,
): Promise<ClaimVideoJobForSubmitResult> {
  if (currentStatus === "submitting") {
    return {
      ok: false,
      httpStatus: 409,
      error: VIDEO_SUBMIT_IN_PROGRESS_ERROR,
      jobStatus: currentStatus,
    };
  }
  if (!isVideoJobReadyForSubmit(currentStatus)) {
    return {
      ok: false,
      httpStatus: 400,
      error: videoSubmitNotReadyError(currentStatus),
      jobStatus: currentStatus,
    };
  }

  const [claimed] = await db
    .update(schema.videoJobs)
    .set({ status: "submitting", updatedAt: new Date() })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        inArray(schema.videoJobs.status, [...VIDEO_SUBMIT_READY_STATUSES]),
      ),
    )
    .returning({ id: schema.videoJobs.id });

  if (!claimed) {
    const [fresh] = await db
      .select({ status: schema.videoJobs.status })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.id, jobId))
      .limit(1);
    const jobStatus = fresh?.status ?? "unknown";
    return {
      ok: false,
      httpStatus: 409,
      error: videoSubmitClaimLostError(jobStatus),
      jobStatus,
    };
  }

  return { ok: true };
}

export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  let advancedToSubmitting = false;
  let jobSnapshot: {
    fileName: string | null;
    scoreTarget: string | null;
    category: string | null;
    /** Status before we wrote "submitting" — used for rollback so event-view re-submits roll back to "complete", not "review". */
    originalStatus: string;
    uploaderSessionId: string;
    enqueuedByHqUserId: string | null;
    hqUserId: string | null;
  } | null = null;

  try {
    const body = (await request.json()) as SubmitBody;

    const db = getDb();
    const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }
    const job = access.job;

    if (!isVideoJobReadyForSubmit(job.status)) {
      if (job.status === "submitting") {
        return NextResponse.json(
          {
            error: VIDEO_SUBMIT_IN_PROGRESS_ERROR,
            status: job.status,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: videoSubmitNotReadyError(job.status),
          status: job.status,
        },
        { status: 400 },
      );
    }

    jobSnapshot = {
      fileName: job.fileName,
      scoreTarget: job.scoreTarget,
      category: job.category,
      originalStatus: job.status,
      uploaderSessionId: job.sessionId,
      enqueuedByHqUserId: job.enqueuedByHqUserId,
      hqUserId: job.hqUserId,
    };

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const target = getScoreTargetOrThrow(scoreTargetId);

    if (isMemberRosterVideoTarget(scoreTargetId)) {
      const ctx = await getRbacContext(session.id);
      if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!ctx.isPlatformMaintainer && !ctx.permissions.has("members:write")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!ctx.hqUserId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const allianceId = job.allianceId;
      if (!allianceId) {
        return NextResponse.json(
          { error: "Alliance context missing on job." },
          { status: 400 },
        );
      }
      if (!job.parseSessionId) {
        return NextResponse.json(
          { error: "Parse session missing on job." },
          { status: 400 },
        );
      }

      const activeRows = body.rows.filter((r) => !r.deleted);
      if (activeRows.length === 0) {
        return NextResponse.json(
          { error: "No rows to submit." },
          { status: 400 },
        );
      }

      const duplicateMembers = findDuplicateMemberAssignments(
        activeRows
          .filter((row) => row.memberId && row.memberName)
          .map((row) => ({
            id: row.id,
            memberId: row.memberId!,
            memberName: row.memberName!,
            ocrName: row.memberName!,
          })),
      );
      if (duplicateMembers.length > 0) {
        const names = duplicateMembers.map((issue) => issue.memberName).join(", ");
        return NextResponse.json(
          {
            error: `Each member can only appear once on the roster. Multiple rows map to: ${names}. Delete duplicate or incorrect rows and try again.`,
            duplicateMembers,
          },
          { status: 400 },
        );
      }

      const rowsMissingRank = activeRows.some(
        (row) =>
          row.allianceRank == null ||
          row.allianceRank < 1 ||
          row.allianceRank > 5,
      );
      if (rowsMissingRank) {
        return NextResponse.json(
          { error: "Every roster row needs an alliance rank (R1–R5)." },
          { status: 400 },
        );
      }

      const hqMembers = await listAllianceMembers(allianceId);
      const quotaCounts = computeProjectedRosterRankCounts(
        hqMembers.map((member) => ({
          ashedMemberId: member.ashedMemberId,
          allianceRank: member.allianceRank,
          status: member.status,
        })),
        activeRows.map((row) => ({
          matchMemberId: row.memberId ?? null,
          allianceRank: row.allianceRank!,
        })),
      );
      const quotaErrors = validateRosterRankQuota(quotaCounts);
      if (quotaErrors.length > 0) {
        return NextResponse.json(
          {
            error: `Roster rank limits not satisfied: ${quotaErrors.join(", ")}.`,
            quotaErrors,
          },
          { status: 400 },
        );
      }

      const claim = await claimVideoJobForSubmit(db, jobId, job.status);
      if (!claim.ok) {
        return NextResponse.json(
          { error: claim.error, status: claim.jobStatus },
          { status: claim.httpStatus },
        );
      }
      advancedToSubmitting = true;

      await emitVideoJobStatus({
        ...videoJobStatusOwnerFields(job),
        jobId,
        status: "submitting",
        fileName: job.fileName,
        scoreTarget: scoreTargetId,
        errorMessage: null,
      });

      for (const row of body.rows) {
        const heroPowerM =
          row.heroPowerM != null && Number.isFinite(row.heroPowerM)
            ? row.heroPowerM
            : null;
        const memberLevel =
          row.memberLevel != null && row.memberLevel >= 1
            ? Math.round(row.memberLevel)
            : null;
        await db
          .update(schema.parsedRows)
          .set({
            memberId: row.memberId ?? null,
            memberName: row.memberName ?? null,
            allianceRank: row.allianceRank ?? null,
            allianceRankTitle: null,
            memberLevel,
            profession: row.profession ?? null,
            powerLevel: formatHeroPowerMForStorage(heroPowerM),
            deleted: row.deleted ? 1 : 0,
            edited: row.deleted ? 0 : 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.parsedRows.id, row.id));
      }

      const result = await commitRosterFromVideoJob({
        allianceId,
        sessionId: session.id,
        hqUserId: ctx.hqUserId,
        parseSessionId: job.parseSessionId,
        ashedConnection: await getAshedConnection(session.id),
      });

      await db
        .update(schema.videoJobs)
        .set({ status: "complete", updatedAt: new Date() })
        .where(eq(schema.videoJobs.id, jobId));

      await emitVideoJobStatus({
        ...videoJobStatusOwnerFields(job),
        jobId,
        status: "complete",
        fileName: job.fileName,
        scoreTarget: scoreTargetId,
        errorMessage: null,
      });

      await db
        .update(schema.parseSessions)
        .set({ status: "submitted", updatedAt: new Date() })
        .where(eq(schema.parseSessions.id, job.parseSessionId));

      await writeAuditLog({
        sessionId: session.id,
        allianceId,
        action: "video.submit",
        resourceType: "alliance_members",
        resourceName: scoreTargetId,
        resourceId: jobId,
        metadata: {
          rowCount: activeRows.length,
          scoreTarget: scoreTargetId,
          created: result.created,
          updated: result.updated,
          inactivated: result.inactivated,
        },
      });

      void notifyEurVideoEvidence(allianceId).catch(() => {});

      return NextResponse.json({
        ok: true,
        submitted: activeRows.length,
        ...result,
        showSolicitedFeedback: false,
        completedUploadCount: 0,
      });
    }

    if (!body.recordedDate) {
      return NextResponse.json(
        { error: "recordedDate is required." },
        { status: 400 },
      );
    }

    const connection = await getAshedConnection(session.id);
    if (!connection) {
      return NextResponse.json({ error: "Ashed not connected" }, { status: 503 });
    }

    const allianceId = job.allianceId;
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context missing on job." },
        { status: 400 },
      );
    }

    const activeRows = body.rows.filter(
      (
        r,
      ): r is SubmitRow & {
        memberId: string;
        memberName: string;
      } => !r.deleted && Boolean(r.memberId) && Boolean(r.memberName),
    );
    if (activeRows.length === 0) {
      return NextResponse.json(
        { error: "No rows to submit." },
        { status: 400 },
      );
    }

    let submitContext: SubmitContext = {
      eventId: body.eventId,
      team: body.team,
      recordedDate: body.recordedDate,
      hqEventId: body.hqEventId ?? job.hqEventId ?? undefined,
      boardKey: body.boardKey ?? job.boardKey ?? undefined,
      commendationId: body.commendationId ?? job.commendationId ?? undefined,
    };

    // Auto-provision an Ashed event entity when the target needs one but the
    // client did not (or could not) select one from the dropdown because none
    // exist yet.  This handles recurring types like alliance-exercise that
    // have no pre-existing events for new alliances, and event types like
    // zombie-siege where the user has no prior events in Ashed.
    if (
      target.eventEntity &&
      !usesHqEventStore(target) &&
      !submitContext.eventId
    ) {
      const provisionBody = buildAshedEventProvisionBody(
        target.eventEntity,
        allianceId,
        submitContext.recordedDate,
      );
      const newEvent = (await base44EntityPost(
        connection,
        target.eventEntity,
        provisionBody,
      )) as { id?: string };
      if (newEvent?.id) {
        submitContext = { ...submitContext, eventId: newEvent.id };
      }
    }

    const contextError = validateSubmitContext(
      target,
      submitContext,
      activeRows.length,
    );
    if (contextError) {
      return NextResponse.json({ error: contextError }, { status: 400 });
    }

    const duplicateMembers = findDuplicateMemberAssignments(
      activeRows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
      })),
    );
    if (duplicateMembers.length > 0) {
      const names = duplicateMembers.map((issue) => issue.memberName).join(", ");
      return NextResponse.json(
        {
          error: `Each member can only appear once on the leaderboard. Multiple rows map to: ${names}. Delete duplicate or incorrect rows and try again.`,
          duplicateMembers,
        },
        { status: 400 },
      );
    }

    let ashedEventId = submitContext.eventId;
    if (usesHqEventStore(target)) {
      if (!submitContext.hqEventId) {
        return NextResponse.json(
          { error: "hqEventId is required for this score target." },
          { status: 400 },
        );
      }
      const provisioned = await resolveAshedEventId(connection, {
        allianceId,
        scoreTargetId: target.id,
        hqEventId: submitContext.hqEventId,
        boardKey: submitContext.boardKey,
        commendationId: submitContext.commendationId,
        recordedDate: submitContext.recordedDate,
      });
      ashedEventId = provisioned.ashedEventId;
    }

    const originalRows = job.parseSessionId
      ? await db
          .select({
            id: schema.parsedRows.id,
            score: schema.parsedRows.score,
            rank: schema.parsedRows.rank,
            memberId: schema.parsedRows.memberId,
            memberName: schema.parsedRows.memberName,
            manuallyAdded: schema.parsedRows.manuallyAdded,
          })
          .from(schema.parsedRows)
          .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId))
      : [];
    const originalRowById = new Map(originalRows.map((row) => [row.id, row]));

    const rowsEdited = activeRows.filter((row) => {
      const original = originalRowById.get(row.id);
      if (!original || original.manuallyAdded === 1) return false;
      return (
        original.score !== row.score ||
        original.rank !== (row.rank ?? null) ||
        original.memberId !== row.memberId ||
        original.memberName !== row.memberName
      );
    }).length;
    const rowsDeleted = body.rows.filter(
      (row) => row.deleted && originalRowById.has(row.id),
    ).length;
    const rowsSaved = activeRows.length;
    const rowsAdded = activeRows.filter((row) => {
      const original = originalRowById.get(row.id);
      return original?.manuallyAdded === 1;
    }).length;

    const payloads = buildSubmitPayloads(
      target,
      allianceId,
      submitContext,
      activeRows.map((row) => ({
        memberId: row.memberId,
        memberName: row.memberName,
        score: row.score ?? "",
        rank: row.rank,
      })),
      ashedEventId,
    );

    const claim = await claimVideoJobForSubmit(db, jobId, job.status);
    if (!claim.ok) {
      return NextResponse.json(
        { error: claim.error, status: claim.jobStatus },
        { status: claim.httpStatus },
      );
    }
    advancedToSubmitting = true;

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "submitting",
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      errorMessage: null,
    });

    await dispatchScoreSubmit(connection, target, payloads);

    if (submitContext.hqEventId) {
      for (const row of activeRows) {
        await upsertHqEventMemberMetadata(submitContext.hqEventId, row.memberId, {
          score: row.score ?? "",
          rank: row.rank ?? null,
          recordedDate: submitContext.recordedDate,
          boardKey: submitContext.boardKey ?? null,
          commendationId: submitContext.commendationId ?? null,
          submittedAt: new Date().toISOString(),
        });
      }
    }

    for (const row of body.rows) {
      const original = originalRowById.get(row.id);
      const rowEdited =
        !row.deleted &&
        original != null &&
        original.manuallyAdded !== 1 &&
        (original.score !== row.score ||
          original.rank !== (row.rank ?? null) ||
          original.memberId !== (row.memberId ?? null) ||
          original.memberName !== (row.memberName ?? null));

      await db
        .update(schema.parsedRows)
        .set({
          memberId: row.memberId ?? null,
          memberName: row.memberName ?? null,
          score: row.score ?? "",
          rank: row.rank ?? null,
          deleted: row.deleted ? 1 : 0,
          edited: rowEdited ? 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.parsedRows.id, row.id));
    }

    await db
      .update(schema.videoJobs)
      .set({
        status: "complete",
        team: submitContext.team ?? null,
        recordedDate: submitContext.recordedDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId,
      status: "complete",
      fileName: job.fileName,
      scoreTarget: scoreTargetId,
      errorMessage: null,
    });

    if (job.parseSessionId) {
      await db
        .update(schema.parseSessions)
        .set({ status: "submitted", updatedAt: new Date() })
        .where(eq(schema.parseSessions.id, job.parseSessionId));

      const { qualityScore, qualityBucket } = computeQualityScore({
        rowsSaved,
        rowsEdited,
        rowsDeleted,
        rowsAdded,
        status: "complete",
      });

      await db
        .update(schema.videoJobs)
        .set({ qualityScore, qualityBucket, qualityComputedAt: new Date() })
        .where(eq(schema.videoJobs.id, jobId));
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId,
      action: "video.submit",
      resourceType: "entity",
      resourceName: target.submitEntity,
      resourceId: jobId,
      metadata: {
        rowCount: activeRows.length,
        scoreTarget: scoreTargetId,
        eventId: ashedEventId,
        hqEventId: submitContext.hqEventId,
        team: submitContext.team ?? null,
        recordedDate: submitContext.recordedDate,
      },
    });

    let solicitedPayload: {
      showSolicitedFeedback: boolean;
      solicitedSource?: string;
      completedUploadCount: number;
    } = {
      showSolicitedFeedback: false,
      completedUploadCount: 0,
    };

    if (session.hqUserId) {
      solicitedPayload = await getSolicitedEligibility({
        hqUserId: session.hqUserId,
        videoJobId: jobId,
      });
    }

    void notifyEurVideoEvidence(allianceId).catch(() => {});

    if (scoreTargetId === "vs-performance" && allianceId && submitContext.recordedDate) {
      void announcePriceIsRightLeaderboardAfterVsUpload({
        allianceId,
        vsRecordedDate: submitContext.recordedDate,
      }).catch((error) => {
        console.error("[train-pir-leaderboard] post-submit announce failed", error);
      });
    }

    return NextResponse.json({
      ok: true,
      submitted: activeRows.length,
      ...solicitedPayload,
    });
  } catch (error) {
    if (advancedToSubmitting && jobSnapshot) {
      try {
        const db = getDb();
        const rollbackStatus = jobSnapshot.originalStatus === "complete"
          ? "complete"
          : "review";
        await db
          .update(schema.videoJobs)
          .set({ status: rollbackStatus, updatedAt: new Date() })
          .where(eq(schema.videoJobs.id, jobId));
        await emitVideoJobStatus({
          ...videoJobStatusOwnerFields({
            sessionId: jobSnapshot.uploaderSessionId,
            enqueuedByHqUserId: jobSnapshot.enqueuedByHqUserId,
            hqUserId: jobSnapshot.hqUserId,
          }),
          jobId,
          status: rollbackStatus,
          fileName: jobSnapshot.fileName ?? null,
          scoreTarget:
            jobSnapshot.scoreTarget ?? jobSnapshot.category ?? null,
          errorMessage: null,
        });
      } catch {
        // Best-effort rollback so the user can retry submit.
      }
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Submit failed",
      },
      { status: 500 },
    );
  }
}
