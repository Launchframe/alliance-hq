import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { getDb, schema } from "@/lib/db";
import { base44EntityPost } from "@/lib/base44/fetch";
import {
  resolveAshedEventId,
  upsertHqEventMemberMetadata,
} from "@/lib/hq-events/provision-ashed";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";
import { findDuplicateMemberAssignments } from "@/lib/video/review-validation";
import { getScoreTargetOrThrow, usesHqEventStore } from "@/lib/video/score-targets";
import {
  getSolicitedEligibility,
} from "@/lib/feedback/solicited-eligibility";
import { dispatchScoreSubmit } from "@/lib/video/submit-dispatch";
import {
  buildSubmitPayloads,
  validateSubmitContext,
  type SubmitContext,
} from "@/lib/video/submit-schemas";
import { computeQualityScore } from "@/lib/video/quality-score";

type Props = {
  params: Promise<{ jobId: string }>;
};

type SubmitRow = {
  id: string;
  memberId?: string | null;
  memberName?: string | null;
  score: string;
  rank?: number | null;
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

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const body = (await request.json()) as SubmitBody;

    if (!body.recordedDate) {
      return NextResponse.json(
        { error: "recordedDate is required." },
        { status: 400 },
      );
    }

    const db = getDb();
    const [job] = await db
      .select()
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

    if (job.status !== "review" && job.status !== "complete") {
      return NextResponse.json(
        { error: "Job is not ready for submit." },
        { status: 400 },
      );
    }

    const scoreTargetId = job.scoreTarget ?? job.category ?? "desert-storm";
    const target = getScoreTargetOrThrow(scoreTargetId);

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
      const newEvent = (await base44EntityPost(connection, target.eventEntity, {
        alliance_id: allianceId,
        start_date: submitContext.recordedDate,
        end_date: submitContext.recordedDate,
      })) as { id?: string };
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
        score: row.score,
        rank: row.rank,
      })),
      ashedEventId,
    );

    await db
      .update(schema.videoJobs)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      sessionId: session.id,
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
          score: row.score,
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
          score: row.score,
          rank: row.rank ?? null,
          deleted: row.deleted ? 1 : 0,
          edited: rowEdited ? 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.parsedRows.id, row.id));
    }

    await db
      .update(schema.videoJobs)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, jobId));

    await emitVideoJobStatus({
      sessionId: session.id,
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

    return NextResponse.json({
      ok: true,
      submitted: activeRows.length,
      ...solicitedPayload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Submit failed",
      },
      { status: 500 },
    );
  }
}
