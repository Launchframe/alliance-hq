import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  commitReviewedEventEvidence,
  EventEvidenceError,
  type EventSaveReceipt,
} from "@/lib/hq-events/evidence-repository.server";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import type { Session } from "@/lib/db/schema";
import {
  eventEvidenceSubmitSchema,
  eventUploadContextSchema,
} from "@/lib/video/warzone-evidence.shared";
import { emitVideoJobStatus } from "@/lib/events/video-jobs";
import { videoJobStatusOwnerFields } from "@/lib/video/video-job-access.shared";
import { recordDataUploadBatch } from "@/lib/data-management/batch-ledger.server";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";

export class EventEvidenceSubmitError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus = 400,
  ) {
    super(code);
    this.name = "EventEvidenceSubmitError";
  }
}

/** Maps submit/commit failures to stable wire codes for the client. */
export function eventEvidenceSubmitErrorResponse(
  error: unknown,
): NextResponse | null {
  if (error instanceof EventEvidenceSubmitError) {
    return NextResponse.json(
      { error: error.code },
      { status: error.httpStatus },
    );
  }
  if (error instanceof EventEvidenceError) {
    const status =
      error.code === "event_not_found" ||
      error.code === "board_not_found" ||
      error.code === "supersede_target_not_found" ||
      error.code === "retract_target_not_found"
        ? 404
        : error.code === "request_conflict" ||
            error.code === "stale_evidence_version"
          ? 409
          : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
  return null;
}

type JobSnapshot = {
  id: string;
  sessionId: string;
  allianceId: string | null;
  hqUserId: string | null;
  enqueuedByHqUserId: string | null;
  scoreTarget: string | null;
  category: string | null;
  status: string;
  ingestMethod: string;
  parseSessionId: string | null;
  groupId: string | null;
  passRole: string | null;
  fileName: string | null;
  eventContext: unknown;
};

/**
 * Warzone media-backed save path (local-first; no Ashed sync here).
 *
 * Validates job/selected-pass/parse-row ownership, the persisted event
 * binding, poll confirmation, member matches, then commits reviewed
 * evidence through `commitReviewedEventEvidence` and marks the job
 * consumed — all observational writes under the commit's transaction.
 */
export async function submitEventEvidenceFromVideoJob(params: {
  session: Session;
  job: JobSnapshot;
  body: unknown;
}): Promise<{ receipt: EventSaveReceipt; rowCount: number }> {
  const { session, job } = params;

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    throw new EventEvidenceSubmitError("alliance_required", 400);
  }

  // Queue processor access is not score-save authority — the caller must
  // hold scores:write on this alliance.
  const denied = await requireAlliancePermission(
    session.id,
    allianceId,
    "scores:write",
  );
  if (denied) {
    throw new EventEvidenceSubmitError("permission_required", 403);
  }

  if (!job.parseSessionId) {
    throw new EventEvidenceSubmitError("no_parse_session", 400);
  }
  if (job.passRole !== "primary") {
    // Only the selected pass can publish; shadow/alternate passes never do.
    throw new EventEvidenceSubmitError("pass_not_selected", 409);
  }

  const parsedContext = eventUploadContextSchema.safeParse(job.eventContext);
  if (!parsedContext.success) {
    throw new EventEvidenceSubmitError("event_not_bound", 409);
  }
  const eventContext = parsedContext.data;

  const parsedBody = eventEvidenceSubmitSchema.safeParse(params.body);
  if (!parsedBody.success) {
    throw new EventEvidenceSubmitError("invalid_rows", 400);
  }
  const input = parsedBody.data;

  const db = getDb();

  // Stale selected pass: a group whose selection moved to another job cannot
  // publish from this parse session.
  if (job.groupId) {
    const [group] = await db
      .select({ selectedJobId: schema.videoUploadGroups.selectedJobId })
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);
    if (group?.selectedJobId && group.selectedJobId !== job.id) {
      throw new EventEvidenceSubmitError("stale_selected_pass", 409);
    }
  }

  const parseRows = await db
    .select()
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

  const rowById = new Map(parseRows.map((row) => [row.id, row]));
  const sourceKind: "image" | "video" =
    job.ingestMethod === "image" ? "image" : "video";

  const memberIds = [
    ...new Set(
      input.rows
        .filter((row) => !row.excluded && row.memberId != null)
        .map((row) => row.memberId!),
    ),
  ];
  if (memberIds.length > 0) {
    // The evidence ledger's memberId is the roster row's ashed_member_id.
    const members = await db
      .select({ id: schema.allianceMembers.ashedMemberId })
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          inArray(schema.allianceMembers.ashedMemberId, memberIds),
        ),
      );
    const known = new Set(members.map((member) => member.id));
    for (const memberId of memberIds) {
      if (!known.has(memberId)) {
        throw new EventEvidenceSubmitError("member_not_found", 400);
      }
    }
  }

  const observations = input.rows
    .filter((row) => !row.excluded)
    .map((row, index) => {
      if (!row.memberId) {
        // Unmatched rows can never silently drop out of a claimed import.
        throw new EventEvidenceSubmitError("unmatched_member", 400);
      }
      const sourceRow = row.rowId != null ? rowById.get(row.rowId) : null;
      if (row.rowId != null && !sourceRow) {
        throw new EventEvidenceSubmitError("row_not_found", 400);
      }
      const parsedEvidence =
        sourceRow?.eventEvidence != null &&
        typeof sourceRow.eventEvidence === "object"
          ? (sourceRow.eventEvidence as Record<string, unknown>)
          : null;
      const isPoll = row.kind === "poll_yes" || row.kind === "poll_no";
      if (isPoll) {
        if (parsedEvidence?.unresolvedOption === true) {
          throw new EventEvidenceSubmitError("unknown_poll_option", 409);
        }
        if (!input.pollOptionsConfirmed) {
          throw new EventEvidenceSubmitError("poll_options_unconfirmed", 409);
        }
        if (row.realScore != null) {
          throw new EventEvidenceSubmitError("poll_row_score_forbidden", 400);
        }
      }
      if (row.kind === "leaderboard") {
        if (row.realScore == null || !/^\d+$/.test(row.realScore)) {
          throw new EventEvidenceSubmitError("invalid_score", 400);
        }
      }
      return {
        sourceRowKey: row.rowId ?? `added-${index}`,
        memberId: row.memberId,
        memberName: row.memberName ?? sourceRow?.memberName ?? null,
        kind: row.kind,
        realScore: isPoll ? null : (row.realScore ?? null),
        observedRank: row.observedRank ?? sourceRow?.rank ?? null,
        pollOption: isPoll ? (row.pollOption ?? (row.kind === "poll_yes" ? 1 : 2)) : null,
        provenance: sourceKind,
        sourceFrame:
          typeof parsedEvidence?.frameIndex === "number"
            ? String(parsedEvidence.frameIndex)
            : null,
        correctionReason: row.correctionReason ?? null,
      };
    });

  const actor = {
    allianceId,
    hqUserId: session.hqUserId ?? null,
    sessionId: session.id,
  };

  const receipt = await commitReviewedEventEvidence(actor, {
    eventId: eventContext.eventId,
    requestId: input.requestId,
    sourceKind,
    sourceRef: job.id,
    boards: [
      {
        boardId: eventContext.boardId,
        observations,
      },
    ],
  });

  // Consume the job + parse session only after the commit succeeds.
  const endedAt = new Date();
  if (!receipt.replayed) {
    await db
      .update(schema.parseSessions)
      .set({ status: "submitted", updatedAt: endedAt })
      .where(eq(schema.parseSessions.id, job.parseSessionId));
    await db
      .update(schema.videoJobs)
      .set({ status: "complete", updatedAt: endedAt })
      .where(and(eq(schema.videoJobs.id, job.id), eq(schema.videoJobs.status, "review")));
    await emitVideoJobStatus({
      ...videoJobStatusOwnerFields(job),
      jobId: job.id,
      status: "complete",
      fileName: job.fileName,
      scoreTarget: job.scoreTarget ?? job.category,
      errorMessage: null,
      updatedAt: endedAt.toISOString(),
    });

    const target = getScoreTargetOrThrow(
      job.scoreTarget ?? job.category ?? "warzone-evidence",
    );
    await recordDataUploadBatch({
      allianceId,
      target,
      submitContext: {
        hqEventId: eventContext.eventId,
        recordedDate: endedAt.toISOString().slice(0, 10),
      },
      rowCount: observations.length,
      sourceJobId: job.id,
      parseSessionId: job.parseSessionId,
      createdByHqUserId: session.hqUserId ?? null,
    });

    await writeAuditLog({
      sessionId: session.id,
      allianceId,
      action: "video.event_submit",
      resourceType: "video_job",
      resourceId: job.id,
      metadata: {
        eventId: eventContext.eventId,
        boardId: eventContext.boardId,
        batchId: receipt.batchId,
        rowCount: observations.length,
      },
    });
  }

  return { receipt, rowCount: observations.length };
}
