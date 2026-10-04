import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { getDb, schema } from "@/lib/db";
import {
  eventProjectionValue,
  resolveEventMemberEvidence,
  type EventObservation,
  type ResolvedEventMember,
} from "@/lib/hq-events/evidence-merge.shared";
import type {
  EventEvidenceKind,
  EventProvenanceKind,
} from "@/lib/hq-events/event-types.shared";

/** Authenticated actor in the canonical session alliance (from the route). */
export type EventActor = {
  allianceId: string;
  hqUserId: string | null;
  sessionId: string | null;
};

export class EventEvidenceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EventEvidenceError";
  }
}

export type EventObservationInput = {
  /** Stable source-row identity — identical replays collapse. */
  sourceRowKey?: string | null;
  memberId: string;
  memberName?: string | null;
  kind: EventEvidenceKind;
  /** Canonical decimal string; must be null for poll rows. */
  realScore?: string | null;
  stage?: number | null;
  observedRank?: number | null;
  pollOption?: number | null;
  provenance: EventProvenanceKind;
  sourceFrame?: string | null;
  sourceOffsetMs?: number | null;
  /** Correction/supersession: the older observation this row replaces. */
  supersedesObservationId?: string | null;
  /** Corrections always carry a reason; the actor is the caller. */
  correctionReason?: string | null;
};

export type CommitReviewedEventEvidenceInput = {
  eventId: string;
  requestId: string;
  sourceKind: "manual" | "video" | "image" | "ashed_import" | "legacy_import";
  sourceRef?: string | null;
  contentHash?: string | null;
  parseRevision?: number | null;
  reviewedRevision?: number | null;
  importManifest?: Record<string, unknown> | null;
  importStatus?: "complete" | "incomplete" | null;
  legacyMappingConfirmed?: boolean;
  boards: {
    boardId: string;
    observations: readonly EventObservationInput[];
    /** Existing observation ids this revision retracts (history preserved). */
    retractsObservationIds?: readonly string[];
  }[];
};

export type EventSaveReceipt = {
  batchId: string;
  requestId: string;
  /** Same request id + same canonical payload — nothing was written. */
  replayed: boolean;
  evidenceVersions: Record<string, number>;
  changedResults: number;
  observationCount: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function requestSignature(
  input: Pick<
    CommitReviewedEventEvidenceInput,
    "eventId" | "sourceKind" | "boards" | "legacyMappingConfirmed" | "sourceRef"
  >,
): string {
  return sha256(stableJson(input));
}

function toObservation(row: typeof schema.hqEventObservations.$inferSelect): EventObservation {
  return {
    id: row.id,
    memberId: row.memberId,
    kind: row.evidenceKind,
    realScore: row.realScore,
    stage: row.stage,
    observedRank: row.observedRank,
    provenance: row.provenance,
    sourceKey: row.sourceRowKey,
    retracted: row.retracted === 1,
    supersededBy: row.supersededByObservationId,
    correction:
      row.correctionActor && row.correctionReason
        ? { actorId: row.correctionActor, reason: row.correctionReason }
        : null,
  };
}

function resultEqualsResolved(
  existing: typeof schema.hqEventMemberResults.$inferSelect,
  resolved: ResolvedEventMember,
  memberName: string | null,
): boolean {
  return (
    existing.realScore === (resolved.class === "real" ? resolved.score : null) &&
    existing.stage === resolved.stage &&
    existing.observedRank === resolved.observedRank &&
    existing.evidenceClass === resolved.class &&
    (existing.conflictKind ?? null) === resolved.conflict &&
    (existing.memberName ?? null) === memberName
  );
}

async function lockBoardsInOrder(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  allianceId: string,
  boardIds: string[],
) {
  const sorted = [...new Set(boardIds)].sort();
  const boards = sorted.length
    ? await tx
        .select()
        .from(schema.hqEventBoards)
        .where(
          and(
            eq(schema.hqEventBoards.allianceId, allianceId),
            inArray(schema.hqEventBoards.id, sorted),
          ),
        )
        .orderBy(asc(schema.hqEventBoards.id))
        .for("update")
    : [];
  const byId = new Map(boards.map((board) => [board.id, board]));
  return { sorted, byId };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function recomputeBoardResults(
  tx: Tx,
  actor: EventActor,
  eventId: string,
  boardId: string,
): Promise<{ changed: number; results: Map<string, ResolvedEventMember> }> {
  const rows = await tx
    .select()
    .from(schema.hqEventObservations)
    .where(
      and(
        eq(schema.hqEventObservations.allianceId, actor.allianceId),
        eq(schema.hqEventObservations.boardId, boardId),
      ),
    );
  const byMember = new Map<string, EventObservation[]>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const list = byMember.get(row.memberId) ?? [];
    list.push(toObservation(row));
    byMember.set(row.memberId, list);
    if (row.memberName) names.set(row.memberId, row.memberName);
  }

  const existing = await tx
    .select()
    .from(schema.hqEventMemberResults)
    .where(
      and(
        eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
        eq(schema.hqEventMemberResults.boardId, boardId),
      ),
    );
  const existingByMember = new Map(existing.map((row) => [row.memberId, row]));

  let changed = 0;
  const results = new Map<string, ResolvedEventMember>();
  const now = new Date();
  for (const [memberId, observations] of byMember) {
    const resolved = resolveEventMemberEvidence(memberId, observations);
    results.set(memberId, resolved);
    const memberName = names.get(memberId) ?? null;
    const prior = existingByMember.get(memberId);
    if (prior && resultEqualsResolved(prior, resolved, memberName)) continue;
    changed += 1;
    if (prior) {
      await tx
        .update(schema.hqEventMemberResults)
        .set({
          realScore: resolved.class === "real" ? resolved.score : null,
          stage: resolved.stage,
          observedRank: resolved.observedRank,
          evidenceClass: resolved.class,
          conflictKind: resolved.conflict,
          memberName,
          version: prior.version + 1,
          updatedAt: now,
        })
        .where(eq(schema.hqEventMemberResults.id, prior.id));
    } else {
      await tx.insert(schema.hqEventMemberResults).values({
        id: `evres-${nanoid(14)}`,
        allianceId: actor.allianceId,
        hqEventId: eventId,
        boardId,
        memberId,
        memberName,
        realScore: resolved.class === "real" ? resolved.score : null,
        stage: resolved.stage,
        observedRank: resolved.observedRank,
        evidenceClass: resolved.class,
        conflictKind: resolved.conflict,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  // Members whose observations were all retracted collapse to no-evidence.
  for (const [memberId, prior] of existingByMember) {
    if (byMember.has(memberId)) continue;
    const resolved = resolveEventMemberEvidence(memberId, []);
    results.set(memberId, resolved);
    if (prior.evidenceClass === "none") continue;
    changed += 1;
    await tx
      .update(schema.hqEventMemberResults)
      .set({
        realScore: null,
        stage: null,
        observedRank: null,
        evidenceClass: "none",
        conflictKind: null,
        version: prior.version + 1,
        updatedAt: now,
      })
      .where(eq(schema.hqEventMemberResults.id, prior.id));
  }
  return { changed, results };
}

async function upsertDesiredSyncItems(
  tx: Tx,
  actor: EventActor,
  eventId: string,
  boardId: string,
  results: Map<string, ResolvedEventMember>,
  resultVersions: Map<string, number>,
): Promise<void> {
  const now = new Date();
  for (const [memberId, resolved] of results) {
    const projection = eventProjectionValue(resolved);
    const payloadHash = sha256(`${resolved.class}:${projection ?? ""}`);
    const remoteKey = `${eventId}:${boardId}:${memberId}`;
    const [existing] = await tx
      .select()
      .from(schema.hqEventSyncItems)
      .where(
        and(
          eq(schema.hqEventSyncItems.allianceId, actor.allianceId),
          eq(schema.hqEventSyncItems.remoteKey, remoteKey),
        ),
      )
      .limit(1);
    const desiredRevision = resultVersions.get(memberId) ?? 1;
    if (existing) {
      if (
        existing.desiredRevision === desiredRevision &&
        existing.desiredPayloadHash === payloadHash
      ) {
        continue;
      }
      await tx
        .update(schema.hqEventSyncItems)
        .set({
          desiredRevision,
          desiredPayloadHash: payloadHash,
          status:
            existing.lastSyncedValueHash === payloadHash ? "synced" : "pending",
          updatedAt: now,
        })
        .where(eq(schema.hqEventSyncItems.id, existing.id));
    } else {
      await tx.insert(schema.hqEventSyncItems).values({
        id: `evsync-${nanoid(14)}`,
        allianceId: actor.allianceId,
        hqEventId: eventId,
        boardId,
        remoteKey,
        memberId,
        desiredRevision,
        desiredPayloadHash: payloadHash,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/**
 * Commit one reviewed evidence batch atomically: idempotent request receipt,
 * appended observations (never deleted), merge recompute, board version bump,
 * readiness invalidation and desired sync items — all under one transaction.
 */
export async function commitReviewedEventEvidence(
  actor: EventActor,
  input: CommitReviewedEventEvidenceInput,
): Promise<EventSaveReceipt> {
  if (!input.requestId) throw new EventEvidenceError("request_id_required");
  if (input.boards.length === 0) throw new EventEvidenceError("board_required");
  const signature = requestSignature(input);
  const db = getDb();

  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.hqEvents)
      .where(
        and(
          eq(schema.hqEvents.id, input.eventId),
          eq(schema.hqEvents.allianceId, actor.allianceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!event) throw new EventEvidenceError("event_not_found");

    const { byId: boardsById } = await lockBoardsInOrder(
      tx,
      actor.allianceId,
      input.boards.map((board) => board.boardId),
    );
    for (const boardInput of input.boards) {
      const board = boardsById.get(boardInput.boardId);
      if (!board || board.hqEventId !== event.id) {
        throw new EventEvidenceError("board_not_found");
      }
    }

    const [receipt] = await tx
      .select()
      .from(schema.hqEventEvidenceBatches)
      .where(
        and(
          eq(schema.hqEventEvidenceBatches.allianceId, actor.allianceId),
          eq(schema.hqEventEvidenceBatches.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (receipt) {
      if (receipt.requestSignature !== signature) {
        throw new EventEvidenceError("request_conflict");
      }
      const evidenceVersions: Record<string, number> = {};
      for (const boardInput of input.boards) {
        evidenceVersions[boardInput.boardId] =
          boardsById.get(boardInput.boardId)!.evidenceVersion;
      }
      return {
        batchId: receipt.id,
        requestId: input.requestId,
        replayed: true,
        evidenceVersions,
        changedResults: 0,
        observationCount: 0,
      };
    }

    const batchId = `evbatch-${nanoid(14)}`;
    const now = new Date();
    await tx.insert(schema.hqEventEvidenceBatches).values({
      id: batchId,
      allianceId: actor.allianceId,
      hqEventId: event.id,
      boardId: input.boards.length === 1 ? input.boards[0]!.boardId : null,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef ?? null,
      parseRevision: input.parseRevision ?? null,
      reviewedRevision: input.reviewedRevision ?? null,
      status: "committed",
      requestId: input.requestId,
      requestSignature: signature,
      contentHash: input.contentHash ?? null,
      importManifest: input.importManifest ?? null,
      importStatus: input.importStatus ?? null,
      legacyMappingConfirmed: input.legacyMappingConfirmed ? 1 : 0,
      createdBy: actor.hqUserId,
      reviewedBy: actor.hqUserId,
      createdAt: now,
      updatedAt: now,
    });

    let observationCount = 0;
    for (const boardInput of input.boards) {
      for (const observation of boardInput.observations) {
        if (
          (observation.kind === "poll_yes" || observation.kind === "poll_no") &&
          observation.realScore != null
        ) {
          throw new EventEvidenceError("poll_row_score_forbidden");
        }
        if (observation.realScore != null) {
          try {
            BigInt(observation.realScore);
          } catch {
            throw new EventEvidenceError("invalid_score");
          }
        }
        const observationId = `evobs-${nanoid(14)}`;
        await tx.insert(schema.hqEventObservations).values({
          id: observationId,
          allianceId: actor.allianceId,
          hqEventId: event.id,
          boardId: boardInput.boardId,
          batchId,
          revision: input.reviewedRevision ?? 1,
          sourceRowKey: observation.sourceRowKey ?? null,
          memberId: observation.memberId,
          memberName: observation.memberName ?? null,
          evidenceKind: observation.kind,
          realScore: observation.realScore ?? null,
          stage: observation.stage ?? null,
          observedRank: observation.observedRank ?? null,
          pollOption: observation.pollOption ?? null,
          provenance: observation.provenance,
          sourceFrame: observation.sourceFrame ?? null,
          sourceOffsetMs: observation.sourceOffsetMs ?? null,
          supersedesObservationId:
            observation.supersedesObservationId ?? null,
          correctionActor: observation.correctionReason
            ? actor.hqUserId
            : null,
          correctionReason: observation.correctionReason ?? null,
          createdAt: now,
        });
        observationCount += 1;
        if (observation.supersedesObservationId) {
          const updated = await tx
            .update(schema.hqEventObservations)
            .set({ supersededByObservationId: observationId })
            .where(
              and(
                eq(
                  schema.hqEventObservations.id,
                  observation.supersedesObservationId,
                ),
                eq(schema.hqEventObservations.allianceId, actor.allianceId),
                eq(schema.hqEventObservations.boardId, boardInput.boardId),
              ),
            )
            .returning({ id: schema.hqEventObservations.id });
          if (updated.length === 0) {
            throw new EventEvidenceError("supersede_target_not_found");
          }
        }
      }
      for (const retractId of boardInput.retractsObservationIds ?? []) {
        const updated = await tx
          .update(schema.hqEventObservations)
          .set({ retracted: 1 })
          .where(
            and(
              eq(schema.hqEventObservations.id, retractId),
              eq(schema.hqEventObservations.allianceId, actor.allianceId),
              eq(schema.hqEventObservations.boardId, boardInput.boardId),
            ),
          )
          .returning({ id: schema.hqEventObservations.id });
        if (updated.length === 0) {
          throw new EventEvidenceError("retract_target_not_found");
        }
      }
    }

    const evidenceVersions: Record<string, number> = {};
    let changedResults = 0;
    for (const boardInput of input.boards) {
      const board = boardsById.get(boardInput.boardId)!;
      const { changed, results } = await recomputeBoardResults(
        tx,
        actor,
        event.id,
        boardInput.boardId,
      );
      changedResults += changed;
      const evidenceVersion = board.evidenceVersion + 1;
      // Evidence changed under the board: the previous ready revision is
      // stale and any empty-board confirmation no longer holds.
      await tx
        .update(schema.hqEventBoards)
        .set({
          evidenceVersion,
          emptyConfirmed: 0,
          updatedAt: now,
        })
        .where(eq(schema.hqEventBoards.id, board.id));
      evidenceVersions[boardInput.boardId] = evidenceVersion;

      const versions = new Map<string, number>();
      const current = await tx
        .select()
        .from(schema.hqEventMemberResults)
        .where(
          and(
            eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
            eq(schema.hqEventMemberResults.boardId, boardInput.boardId),
          ),
        );
      for (const row of current) versions.set(row.memberId, row.version);
      await upsertDesiredSyncItems(
        tx,
        actor,
        event.id,
        boardInput.boardId,
        results,
        versions,
      );
    }

    await writeOfficerActionAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId,
      action: "event_evidence_commit",
      severity: "update",
      resourceType: "hq_event",
      resourceId: event.id,
      permission: "scores:write",
      metadata: {
        batchId,
        requestId: input.requestId,
        sourceKind: input.sourceKind,
        boardIds: input.boards.map((board) => board.boardId),
        observationCount,
        changedResults,
        evidenceVersions,
      },
    });

    return {
      batchId,
      requestId: input.requestId,
      replayed: false,
      evidenceVersions,
      changedResults,
      observationCount,
    };
  });
}

export type EventEvidencePage = {
  boards: (typeof schema.hqEventBoards.$inferSelect & { ready: boolean })[];
  results: (typeof schema.hqEventMemberResults.$inferSelect)[];
  observations: (typeof schema.hqEventObservations.$inferSelect)[];
  batches: (typeof schema.hqEventEvidenceBatches.$inferSelect)[];
  nextCursor: string | null;
};

/** Paginated evidence view (default 50, max 100) for an event board scope. */
export async function loadEventEvidence(
  actor: EventActor,
  input: {
    eventId: string;
    boardId?: string | null;
    limit?: number;
    cursor?: string | null;
  },
): Promise<EventEvidencePage | null> {
  const db = getDb();
  const [event] = await db
    .select()
    .from(schema.hqEvents)
    .where(
      and(
        eq(schema.hqEvents.id, input.eventId),
        eq(schema.hqEvents.allianceId, actor.allianceId),
      ),
    )
    .limit(1);
  if (!event) return null;

  const boards = (
    await db
      .select()
      .from(schema.hqEventBoards)
      .where(
        and(
          eq(schema.hqEventBoards.allianceId, actor.allianceId),
          eq(schema.hqEventBoards.hqEventId, event.id),
        ),
      )
      .orderBy(asc(schema.hqEventBoards.boardKey))
  ).map((board) => ({
    ...board,
    ready:
      board.readyVersion != null && board.readyVersion === board.evidenceVersion,
  }));

  const boardScope = input.boardId ?? boards[0]?.id ?? null;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;

  const results = boardScope
    ? await db
        .select()
        .from(schema.hqEventMemberResults)
        .where(
          and(
            eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
            eq(schema.hqEventMemberResults.boardId, boardScope),
          ),
        )
        .orderBy(asc(schema.hqEventMemberResults.memberId))
    : [];

  const observations = boardScope
    ? await db
        .select()
        .from(schema.hqEventObservations)
        .where(
          and(
            eq(schema.hqEventObservations.allianceId, actor.allianceId),
            eq(schema.hqEventObservations.boardId, boardScope),
          ),
        )
        .orderBy(
          asc(schema.hqEventObservations.createdAt),
          asc(schema.hqEventObservations.id),
        )
        .limit(limit + 1)
        .offset(Number.isFinite(offset) && offset > 0 ? offset : 0)
    : [];

  const batches = await db
    .select()
    .from(schema.hqEventEvidenceBatches)
    .where(
      and(
        eq(schema.hqEventEvidenceBatches.allianceId, actor.allianceId),
        eq(schema.hqEventEvidenceBatches.hqEventId, event.id),
      ),
    )
    .orderBy(desc(schema.hqEventEvidenceBatches.createdAt));

  return {
    boards,
    results,
    observations: observations.slice(0, limit),
    batches,
    nextCursor:
      observations.length > limit ? String(offset + limit) : null,
  };
}

export type ConfirmEventReadinessInput = {
  eventId: string;
  boardId: string;
  /** Optimistic fence: must equal the board's current evidence_version. */
  expectedEvidenceVersion: number;
  action: "mark" | "invalidate";
  /** Selected evidence source batch ids included in the ready projection. */
  readySources?: readonly string[] | null;
  /** Required when marking ready with no scored members. */
  emptyConfirmed?: boolean;
};

export async function confirmEventReadiness(
  actor: EventActor,
  input: ConfirmEventReadinessInput,
): Promise<{ readyVersion: number | null }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: schema.hqEvents.id })
      .from(schema.hqEvents)
      .where(
        and(
          eq(schema.hqEvents.id, input.eventId),
          eq(schema.hqEvents.allianceId, actor.allianceId),
        ),
      )
      .limit(1);
    if (!event) throw new EventEvidenceError("event_not_found");

    const [board] = await tx
      .select()
      .from(schema.hqEventBoards)
      .where(
        and(
          eq(schema.hqEventBoards.id, input.boardId),
          eq(schema.hqEventBoards.allianceId, actor.allianceId),
          eq(schema.hqEventBoards.hqEventId, event.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!board) throw new EventEvidenceError("board_not_found");

    const now = new Date();
    if (input.action === "invalidate") {
      await tx
        .update(schema.hqEventBoards)
        .set({
          readyVersion: null,
          readySources: null,
          readyBy: actor.hqUserId,
          readyAt: now,
          emptyConfirmed: 0,
          updatedAt: now,
        })
        .where(eq(schema.hqEventBoards.id, board.id));
      await writeOfficerActionAudit({
        sessionId: actor.sessionId,
        allianceId: actor.allianceId,
        hqUserId: actor.hqUserId,
        action: "event_readiness_invalidate",
        severity: "update",
        resourceType: "hq_event_board",
        resourceId: board.id,
        permission: "trains:write",
        metadata: { eventId: event.id, evidenceVersion: board.evidenceVersion },
      });
      return { readyVersion: null };
    }

    if (board.evidenceVersion !== input.expectedEvidenceVersion) {
      throw new EventEvidenceError("stale_evidence_version");
    }

    const [incomplete] = await tx
      .select({ id: schema.hqEventEvidenceBatches.id })
      .from(schema.hqEventEvidenceBatches)
      .where(
        and(
          eq(schema.hqEventEvidenceBatches.allianceId, actor.allianceId),
          eq(schema.hqEventEvidenceBatches.hqEventId, event.id),
          eq(schema.hqEventEvidenceBatches.importStatus, "incomplete"),
        ),
      )
      .limit(1);
    if (incomplete) throw new EventEvidenceError("import_incomplete");

    const [scored] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.hqEventMemberResults)
      .where(
        and(
          eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
          eq(schema.hqEventMemberResults.boardId, board.id),
          inArray(schema.hqEventMemberResults.evidenceClass, [
            "real",
            "legacy_leaderboard",
          ]),
        ),
      );
    if ((scored?.count ?? 0) === 0 && input.emptyConfirmed !== true) {
      throw new EventEvidenceError("empty_confirmation_required");
    }

    await tx
      .update(schema.hqEventBoards)
      .set({
        readyVersion: board.evidenceVersion,
        readySources: input.readySources ? [...input.readySources] : null,
        readyBy: actor.hqUserId,
        readyAt: now,
        emptyConfirmed: input.emptyConfirmed === true ? 1 : 0,
        updatedAt: now,
      })
      .where(eq(schema.hqEventBoards.id, board.id));

    await writeOfficerActionAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId,
      action: "event_readiness_mark",
      severity: "update",
      resourceType: "hq_event_board",
      resourceId: board.id,
      permission: "trains:write",
      metadata: {
        eventId: event.id,
        readyVersion: board.evidenceVersion,
        emptyConfirmed: input.emptyConfirmed === true,
        readySourceCount: input.readySources?.length ?? null,
      },
    });
    return { readyVersion: board.evidenceVersion };
  });
}

/**
 * Explicit, idempotent bootstrap of legacy `hq_event_members` metadata into
 * the evidence ledger for one event+board. Preserves Frontline stage and
 * provenance; ambiguous metadata becomes a review task rather than a guess.
 */
export async function bootstrapEventBoardFromLegacyMetadata(
  actor: EventActor,
  input: { eventId: string; boardId: string; requestId: string },
): Promise<{ receipt: EventSaveReceipt | null; reviewTasks: string[] }> {
  const db = getDb();
  const [event] = await db
    .select()
    .from(schema.hqEvents)
    .where(
      and(
        eq(schema.hqEvents.id, input.eventId),
        eq(schema.hqEvents.allianceId, actor.allianceId),
      ),
    )
    .limit(1);
  if (!event) throw new EventEvidenceError("event_not_found");

  const rows = await db
    .select()
    .from(schema.hqEventMembers)
    .where(eq(schema.hqEventMembers.hqEventId, event.id));

  const observations: EventObservationInput[] = [];
  const reviewTasks: string[] = [];
  for (const row of rows) {
    const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== "object") {
      reviewTasks.push(row.id);
      continue;
    }
    const score = metadata.score;
    const stage = metadata.frontlineStage;
    const hasScore =
      typeof score === "number" ||
      (typeof score === "string" && /^\d+$/.test(score));
    const hasStage = typeof stage === "number" && Number.isInteger(stage);
    if (!hasScore && !hasStage) {
      // No score or stage — cannot tell leaderboard from participation noise.
      reviewTasks.push(row.id);
      continue;
    }
    const sourceRowId =
      typeof metadata.sourceRowId === "string" ? metadata.sourceRowId : row.id;
    observations.push({
      sourceRowKey: `legacy:${row.memberId}:${sourceRowId}`,
      memberId: row.memberId,
      memberName: null,
      kind: "leaderboard",
      realScore: hasScore ? String(score) : null,
      stage: hasStage ? (stage as number) : null,
      observedRank:
        typeof metadata.rank === "number" ? (metadata.rank as number) : null,
      provenance: "legacy",
    });
  }

  if (observations.length === 0) return { receipt: null, reviewTasks };
  const receipt = await commitReviewedEventEvidence(actor, {
    eventId: input.eventId,
    requestId: input.requestId,
    sourceKind: "legacy_import",
    sourceRef: `hq_event_members:${input.eventId}`,
    boards: [{ boardId: input.boardId, observations }],
  });
  return { receipt, reviewTasks };
}
