import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  ASHED_SCORE_LIST_LIMIT,
  fetchAshedScoreRowsRaw,
  type RawAshedScoreRow,
} from "@/lib/data-management/ashed-date-scores.server";
import {
  EVENT_LEGACY_LEADERBOARD_CREDIT,
  EVENT_POLL_NO_CREDIT,
  EVENT_POLL_YES_CREDIT,
} from "@/lib/hq-events/event-types.shared";
import {
  commitReviewedEventEvidence,
  EventEvidenceError,
  type CommitReviewedEventEvidenceInput,
  type EventActor,
  type EventObservationInput,
} from "@/lib/hq-events/evidence-repository.server";

export class AshedImportError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AshedImportError";
  }
}

/**
 * Legacy sentinel values only become poll/legacy evidence after an explicit
 * per-import confirmation. Before that they remain staged and never enter
 * canonical results.
 */
export type AshedImportClassification =
  | { kind: "unconfirmed" }
  | { kind: "real" }
  | { kind: "legacy" };

export type AshedImportInput = {
  /** HQ occurrence the import feeds. */
  eventId: string;
  /** Explicit Ashed occurrence id — must equal every row's `event_id`. */
  remoteEventId: string;
  /** Idempotency key for this reviewed import save. */
  requestId: string;
  /** Ashed list entity (e.g. `SeasonalEventScore`). */
  submitEntity: string;
  classification: AshedImportClassification;
};

export type AshedImportReceipt = {
  imported: boolean;
  replayed: boolean;
  staged: boolean;
  incomplete: boolean;
  rowCount: number;
  batchId: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildManifest(input: {
  submitEntity: string;
  remoteEventId: string;
  classification: AshedImportClassification["kind"];
  rows: RawAshedScoreRow[];
  complete: boolean;
}): Record<string, unknown> {
  const rowIds = input.rows
    .map(
      (row) =>
        `${row.id ?? ""}:${row.member_id ?? ""}:${row.score ?? ""}:${row.team ?? ""}`,
    )
    .sort();
  return {
    submitEntity: input.submitEntity,
    remoteEventId: input.remoteEventId,
    rowCount: input.rows.length,
    rowIdsSha256: sha256(rowIds.join("\n")),
    classification: input.classification,
    complete: input.complete,
  };
}

/**
 * Validate every returned row against the expected tenant scope. Any
 * malformed or cross-tenant row rejects the whole import — partial boards
 * are never committed.
 */
function validateRemoteRows(input: {
  rows: RawAshedScoreRow[];
  ashedAllianceId: string;
  remoteEventId: string;
  hqEventId: string;
  submitEntity: string;
}): RawAshedScoreRow[] {
  for (const row of input.rows) {
    if (typeof row !== "object" || row == null || !row.id) {
      throw new AshedImportError("invalid_remote_row");
    }
    if (row.event_id != null && row.event_id !== input.remoteEventId) {
      throw new AshedImportError("wrong_tenant_remote_row");
    }
    if (row.hq_event_id != null && row.hq_event_id !== input.hqEventId) {
      // Rows stamped with an HQ event id must point at this occurrence.
      throw new AshedImportError("wrong_tenant_remote_row");
    }
    if (row.member_id == null || row.member_id === "") {
      throw new AshedImportError("invalid_remote_row");
    }
    const team = row.team ?? null;
    if (team != null && team !== "A" && team !== "B") {
      throw new AshedImportError("invalid_remote_row");
    }
  }
  return input.rows;
}

function toObservations(input: {
  rows: RawAshedScoreRow[];
  boardId: string;
  remoteEventId: string;
  teamScope: string | null;
  classification: Exclude<AshedImportClassification["kind"], "unconfirmed">;
}): EventObservationInput[] {
  return input.rows.map((row) => {
    const score = row.score == null ? null : String(row.score);
    const base = {
      memberId: row.member_id!,
      memberName: row.member_name ?? null,
      observedRank: row.rank ?? null,
      provenance: "ashed" as const,
    };
    if (input.classification === "legacy") {
      if (score === EVENT_LEGACY_LEADERBOARD_CREDIT) {
        return { ...base, kind: "legacy_leaderboard" as const, realScore: null };
      }
      if (score === EVENT_POLL_YES_CREDIT) {
        return { ...base, kind: "poll_yes" as const, realScore: null, pollOption: 1 };
      }
      if (score === EVENT_POLL_NO_CREDIT) {
        return { ...base, kind: "poll_no" as const, realScore: null, pollOption: 0 };
      }
      return { ...base, kind: "leaderboard" as const, realScore: score };
    }
    return { ...base, kind: "leaderboard" as const, realScore: score };
  });
}

/**
 * Explicitly link an HQ occurrence to an Ashed event id. Idempotent on the
 * external-id tuple; linking a remote id already bound to a different HQ
 * event is a conflict, never a silent re-point.
 */
export async function linkAshedEvent(
  actor: EventActor,
  input: { eventId: string; remoteEventId: string },
): Promise<{ linked: boolean; alreadyLinked: boolean }> {
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

    const [existing] = await tx
      .select()
      .from(schema.hqEventExternalLinks)
      .where(
        and(
          eq(schema.hqEventExternalLinks.allianceId, actor.allianceId),
          eq(schema.hqEventExternalLinks.entityKind, "event"),
          eq(schema.hqEventExternalLinks.externalSource, "ashed"),
          eq(schema.hqEventExternalLinks.externalId, input.remoteEventId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.hqEventId !== event.id) {
        throw new AshedImportError("remote_id_linked_elsewhere");
      }
      return { linked: true, alreadyLinked: true };
    }

    await tx.insert(schema.hqEventExternalLinks).values({
      id: `evlnk-${nanoid(14)}`,
      allianceId: actor.allianceId,
      entityKind: "event",
      hqEventId: event.id,
      externalSource: "ashed",
      externalId: input.remoteEventId,
      createdBy: actor.hqUserId,
      createdAt: new Date(),
    });
    if (!event.ashedEventId) {
      await tx
        .update(schema.hqEvents)
        .set({ ashedEventId: input.remoteEventId, updatedAt: new Date() })
        .where(eq(schema.hqEvents.id, event.id));
    }
    return { linked: true, alreadyLinked: false };
  });
}

/**
 * Link + import one Ashed occurrence into the evidence ledger.
 *
 * - Verifies each remote row's event/team/member; wrong-tenant or malformed
 *   rows reject the whole import.
 * - Records `import_status=incomplete` when the capped list cannot be proven
 *   complete; incomplete imports cannot be marked ready.
 * - Persists a manifest (source ids hash); an identical re-import is a no-op.
 * - Unconfirmed rows stay staged (`status='staged'`, no observations) until
 *   the officer confirms `real` or `legacy` classification.
 */
export async function importAshedEventEvidence(
  actor: EventActor,
  connection: ParsedConnection,
  input: AshedImportInput,
  options: { ashedAllianceId: string },
): Promise<AshedImportReceipt> {
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

  const rows = await fetchAshedScoreRowsRaw({
    connection,
    submitEntity: input.submitEntity,
    ashedAllianceId: options.ashedAllianceId,
    eventId: input.remoteEventId,
  });
  validateRemoteRows({
    rows,
    ashedAllianceId: options.ashedAllianceId,
    remoteEventId: input.remoteEventId,
    hqEventId: event.id,
    submitEntity: input.submitEntity,
  });

  // The shared list call is capped at ASHED_SCORE_LIST_LIMIT; hitting the cap
  // means completeness cannot be proven.
  const complete = rows.length < ASHED_SCORE_LIST_LIMIT;
  const manifest = buildManifest({
    submitEntity: input.submitEntity,
    remoteEventId: input.remoteEventId,
    classification: input.classification.kind,
    rows,
    complete,
  });

  // Identical re-import: same remote row-id set already committed → no-op.
  const [latest] = await db
    .select()
    .from(schema.hqEventEvidenceBatches)
    .where(
      and(
        eq(schema.hqEventEvidenceBatches.allianceId, actor.allianceId),
        eq(schema.hqEventEvidenceBatches.hqEventId, event.id),
        eq(schema.hqEventEvidenceBatches.sourceKind, "ashed_import"),
        eq(schema.hqEventEvidenceBatches.sourceRef, input.remoteEventId),
      ),
    )
    .orderBy(desc(schema.hqEventEvidenceBatches.createdAt))
    .limit(1);
  const latestManifest = latest?.importManifest as {
    rowIdsSha256?: string;
    classification?: string;
  } | null;
  if (
    latest != null &&
    latestManifest != null &&
    latest.status === "committed" &&
    latestManifest.rowIdsSha256 === manifest.rowIdsSha256 &&
    latestManifest.classification === input.classification.kind &&
    latest.importStatus === (complete ? "complete" : "incomplete")
  ) {
    return {
      imported: true,
      replayed: true,
      staged: false,
      incomplete: !complete,
      rowCount: rows.length,
      batchId: latest.id,
    };
  }

  if (input.classification.kind === "unconfirmed") {
    const batchId = `evbatch-${nanoid(14)}`;
    const now = new Date();
    await db.insert(schema.hqEventEvidenceBatches).values({
      id: batchId,
      allianceId: actor.allianceId,
      hqEventId: event.id,
      sourceKind: "ashed_import",
      sourceRef: input.remoteEventId,
      status: "staged",
      requestId: input.requestId,
      requestSignature: sha256(`staged:${input.remoteEventId}`),
      importManifest: manifest,
      importStatus: complete ? "complete" : "incomplete",
      createdBy: actor.hqUserId,
      createdAt: now,
      updatedAt: now,
    });
    return {
      imported: true,
      replayed: false,
      staged: true,
      incomplete: !complete,
      rowCount: rows.length,
      batchId,
    };
  }

  // Resolve target boards by remote team values.
  const boards = await db
    .select()
    .from(schema.hqEventBoards)
    .where(
      and(
        eq(schema.hqEventBoards.allianceId, actor.allianceId),
        eq(schema.hqEventBoards.hqEventId, event.id),
      ),
    );
  if (boards.length === 0) throw new EventEvidenceError("board_not_found");
  const boardByKey = new Map(boards.map((board) => [board.boardKey, board]));
  const defaultBoard = boards.find((board) => board.boardKey === "main") ?? boards[0]!;

  const boardObservations = new Map<string, EventObservationInput[]>();
  const push = (boardId: string, observation: EventObservationInput) => {
    const list = boardObservations.get(boardId) ?? [];
    list.push(observation);
    boardObservations.set(boardId, list);
  };

  for (const row of rows) {
    const team = row.team ?? null;
    let board = defaultBoard;
    if (team === "A" || team === "B") {
      const keyed =
        boardByKey.get(team) ??
        boardByKey.get(`team_${team.toLowerCase()}`) ??
        boardByKey.get(team.toLowerCase());
      if (keyed) board = keyed;
      else if (boards.length > 1) {
        throw new AshedImportError("team_board_unresolved");
      }
    } else if (boards.length > 1 && defaultBoard.boardKey !== "main") {
      throw new AshedImportError("team_board_unresolved");
    }
    for (const observation of toObservations({
      rows: [row],
      boardId: board.id,
      remoteEventId: input.remoteEventId,
      teamScope: team,
      classification: input.classification.kind,
    })) {
      // The value is part of the source identity: a changed remote score is a
      // new fact that surfaces as reviewable evidence/conflict, while an
      // identical re-import collapses in the merge.
      const rawScore = row.score == null ? "null" : String(row.score);
      push(board.id, {
        ...observation,
        sourceRowKey: `ashed:${input.submitEntity}:${input.remoteEventId}:${row.id}:${input.classification.kind}:${rawScore}`,
      });
    }
  }

  const commitInput: CommitReviewedEventEvidenceInput = {
    eventId: event.id,
    requestId: input.requestId,
    sourceKind: "ashed_import",
    sourceRef: input.remoteEventId,
    importManifest: manifest,
    importStatus: complete ? "complete" : "incomplete",
    legacyMappingConfirmed: input.classification.kind === "legacy",
    boards: [...boardObservations.entries()].map(([boardId, observations]) => ({
      boardId,
      observations,
    })),
  };
  const receipt = await commitReviewedEventEvidence(actor, commitInput);
  return {
    imported: true,
    replayed: receipt.replayed,
    staged: false,
    incomplete: !complete,
    rowCount: rows.length,
    batchId: receipt.batchId,
  };
}
