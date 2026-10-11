import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, or, lt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ParsedConnection } from "@/lib/connectionString";
import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { base44EntityPost, base44Json } from "@/lib/base44/fetch";
import { getDb, schema } from "@/lib/db";
import { getAshedConnection } from "@/lib/session";
import { eventProjectionValue } from "@/lib/hq-events/evidence-merge.shared";
import { resolveAshedEventId } from "@/lib/hq-events/provision-ashed";
import {
  EVENT_FAMILY_POLICY,
  EVENT_TARGETS,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";
import { resolveEventMemberEvidence } from "@/lib/hq-events/evidence-merge.shared";
import type { EventActor } from "@/lib/hq-events/evidence-repository.server";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";

/**
 * Event → Ashed sync is CREATE-ONLY + CONFLICTS by maintainer decision:
 * remote rows are posted once and never updated, replaced, or deleted here.
 * A remote row that already exists with a different value becomes a
 * `conflict` for officer review — reconciling or editing existing Ashed rows
 * is a documented blocker (see AGENTS.md "Event evidence").
 */

const LEASE_MS = 60_000;
/** A list response at this size can't be proven complete → never POST. */
const REMOTE_READ_CAP = 100;

/** Remote score entity per event family (Storm boards carry team). */
const EVENT_SYNC_ENTITY: Record<EventTarget, string> = {
  "warzone-duel": "SeasonalScore",
  "frontline-breakthrough": "SeasonalScore",
  seasonal: "SeasonalScore",
  "desert-storm": "DesertStormScore",
  "canyon-storm": "CanyonStormScore",
};

type RemoteRow = {
  id?: string;
  alliance_id?: string;
  event_id?: string;
  member_id?: string;
  member_name?: string;
  team?: string;
  score?: number | string | null;
};

export type EventSyncItemStatus =
  | "pending"
  | "synced"
  | "conflict"
  | "failed"
  | "unsupported"
  | "uncertain";

export type EventSyncSummary = {
  status: "ok" | "partial" | "not_configured" | "connection_required";
  synced: number;
  pending: number;
  conflict: number;
  failed: number;
  uncertain: number;
  unsupported: number;
};

function toEventTarget(value: string | null): EventTarget | null {
  return value != null && (EVENT_TARGETS as readonly string[]).includes(value)
    ? (value as EventTarget)
    : null;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function remoteStatusCode(error: unknown): number | null {
  const match =
    error instanceof Error ? error.message.match(/\((\d{3})\)/) : null;
  return match ? Number(match[1]) : null;
}

/** Canonical numeric compare for remote score values. */
function scoresEqual(remote: unknown, desired: string): boolean {
  if (remote == null) return false;
  try {
    const r = BigInt(String(remote).replace(/\.0+$/, ""));
    return r === BigInt(desired);
  } catch {
    return String(remote) === desired;
  }
}

/**
 * Push one event/board's pending ledger projections to Ashed, one sync item
 * at a time. Never runs inside a DB lock/transaction — leases mark in-flight
 * work, and post-POST uncertainty reconciles by re-reading on the next run.
 */
export async function syncEventResults(
  actor: EventActor,
  input: { eventId: string; boardIds?: string[] },
): Promise<EventSyncSummary> {
  const db = getDb();
  const summary: EventSyncSummary = {
    status: "ok",
    synced: 0,
    pending: 0,
    conflict: 0,
    failed: 0,
    uncertain: 0,
    unsupported: 0,
  };

  const ashedAllianceId = await getAshedAllianceIdIfLinked(actor.allianceId);
  if (!ashedAllianceId) {
    // Native-only alliance: nothing to do, no credential needed.
    summary.status = "not_configured";
    return summary;
  }

  const connection = actor.sessionId
    ? await getAshedConnection(actor.sessionId)
    : null;
  if (!connection) {
    await flagBoardItems(actor, input, {
      status: "failed",
      errorCode: "connection_required",
    });
    summary.status = "connection_required";
    return summary;
  }

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
  if (!event) return summary;

  const family = toEventTarget(event.eventFamily) ?? toEventTarget(event.scoreTarget);
  const submitEntity = family ? EVENT_SYNC_ENTITY[family] : null;
  if (!family || !submitEntity) {
    await flagBoardItems(actor, input, {
      status: "unsupported",
      errorCode: "unsupported_family",
    });
    summary.status = "partial";
    return summary;
  }
  const targetId = family === "warzone-duel" ? "seasonal" : family;
  const syncTarget = getScoreTargetOrThrow(targetId);
  const teamScoped = EVENT_FAMILY_POLICY[family].teamScoped;

  const boardFilter = input.boardIds?.length
    ? and(
        eq(schema.hqEventBoards.hqEventId, event.id),
        eq(schema.hqEventBoards.allianceId, actor.allianceId),
        inArray(schema.hqEventBoards.id, input.boardIds),
      )
    : and(
        eq(schema.hqEventBoards.hqEventId, event.id),
        eq(schema.hqEventBoards.allianceId, actor.allianceId),
      );
  const boards = await db
    .select()
    .from(schema.hqEventBoards)
    .where(boardFilter);

  const runLease = `lease-${nanoid(16)}`;

  for (const board of boards) {
    // Resolve (or provision) the remote event id once per board. Provisioning
    // reuses a confirmed series — never creates a new series per run.
    let remoteEventId = board.ashedEventId ?? null;
    if (!remoteEventId && !syncTarget.seriesEntity) {
      // Non-series boards must already be linked; nothing to provision.
      await flagBoardItems(actor, { eventId: event.id, boardIds: [board.id] }, {
        status: "failed",
        errorCode: "unlinked_board",
      });
      continue;
    }
    if (!remoteEventId) {
      try {
        const provisioned = await resolveAshedEventId(connection, {
          allianceId: actor.allianceId,
          scoreTargetId: targetId,
          hqEventId: event.id,
          boardKey: board.boardKey,
          recordedDate: event.startDate ?? event.createdAt.toISOString().slice(0, 10),
        });
        remoteEventId = provisioned.ashedEventId;
      } catch {
        await flagBoardItems(actor, { eventId: event.id, boardIds: [board.id] }, {
          status: "failed",
          errorCode: "provision_failed",
        });
        continue;
      }
    }

    // Remote rows for this event/board — one read per board, verified against
    // alliance/event/team before any POST is considered.
    const team = teamScoped ? board.boardKey : null;
    const remoteRows = await listRemoteRows(
      connection,
      submitEntity,
      ashedAllianceId,
      remoteEventId,
      team,
    );
    if (remoteRows == null) {
      const flagged = await flagBoardItems(
        actor,
        { eventId: event.id, boardIds: [board.id] },
        { status: "pending", errorCode: "incomplete_read" },
      );
      summary.pending += flagged;
      continue;
    }
    const remoteByMember = new Map<string, RemoteRow[]>();
    for (const row of remoteRows) {
      if (
        row.alliance_id !== ashedAllianceId ||
        row.event_id !== remoteEventId ||
        (teamScoped && row.team !== team)
      ) {
        continue; // foreign rows never bind
      }
      const key = String(row.member_id ?? "");
      const list = remoteByMember.get(key) ?? [];
      list.push(row);
      remoteByMember.set(key, list);
    }

    const items = await db
      .select()
      .from(schema.hqEventSyncItems)
      .where(
        and(
          eq(schema.hqEventSyncItems.allianceId, actor.allianceId),
          eq(schema.hqEventSyncItems.hqEventId, event.id),
          eq(schema.hqEventSyncItems.boardId, board.id),
          or(
            eq(schema.hqEventSyncItems.status, "pending"),
            eq(schema.hqEventSyncItems.status, "failed"),
            eq(schema.hqEventSyncItems.status, "uncertain"),
            // Re-read only: bind if remote now matches HQ; never POST over conflict.
            eq(schema.hqEventSyncItems.status, "conflict"),
          ),
        ),
      )
      .orderBy(asc(schema.hqEventSyncItems.memberId));

    for (const item of items) {
      // A stale lease/older desired revision can never mark newer data synced.
      if (
        item.lastSyncedRevision != null &&
        item.desiredRevision <= item.lastSyncedRevision &&
        item.status !== "uncertain"
      ) {
        continue;
      }

      const [memberResult] = await db
        .select()
        .from(schema.hqEventMemberResults)
        .where(
          and(
            eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
            eq(schema.hqEventMemberResults.boardId, board.id),
            eq(schema.hqEventMemberResults.memberId, item.memberId),
          ),
        )
        .limit(1);
      const projection = memberResult
        ? eventProjectionValue({
            class: memberResult.evidenceClass,
            score: memberResult.realScore,
          })
        : null;

      // Lease from claim time (not sync start) so a long board loop cannot
      // publish already-expired leases that a peer run steals mid-POST.
      const claimed = await db
        .update(schema.hqEventSyncItems)
        .set({
          leaseToken: runLease,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.hqEventSyncItems.id, item.id),
            or(
              isNull(schema.hqEventSyncItems.leaseExpiresAt),
              lt(schema.hqEventSyncItems.leaseExpiresAt, new Date()),
              eq(schema.hqEventSyncItems.leaseToken, runLease),
            ),
          ),
        )
        .returning({ id: schema.hqEventSyncItems.id });
      if (claimed.length === 0) {
        summary.pending += 1;
        continue;
      }

      if (projection == null) {
        // Nothing to send — member has no outbound value.
        const marked = await markItem(
          item.id,
          {
            status: "synced",
            remoteRowId: null,
            lastSyncedRevision: item.desiredRevision,
            lastSyncedValueHash: item.desiredPayloadHash,
            errorCode: null,
          },
          runLease,
        );
        if (marked) summary.synced += 1;
        else summary.pending += 1;
        continue;
      }
      if (BigInt(projection) > BigInt(Number.MAX_SAFE_INTEGER)) {
        const marked = await markItem(
          item.id,
          { status: "unsupported", errorCode: "precisionUnsupported" },
          runLease,
        );
        if (marked) summary.unsupported += 1;
        else summary.pending += 1;
        continue;
      }

      const remote = remoteByMember.get(item.memberId) ?? [];
      const outcome = await reconcileRemoteRow({
        connection,
        submitEntity,
        item,
        remote,
        desiredValue: projection,
        ashedAllianceId,
        remoteEventId,
        team,
        memberResult,
        event,
        leaseToken: runLease,
      });
      summary[outcome] += 1;
    }
  }

  if (
    summary.pending > 0 ||
    summary.conflict > 0 ||
    summary.failed > 0 ||
    summary.uncertain > 0 ||
    summary.unsupported > 0
  ) {
    summary.status = "partial";
  }
  return summary;
}

async function reconcileRemoteRow(input: {
  connection: ParsedConnection;
  submitEntity: string;
  item: typeof schema.hqEventSyncItems.$inferSelect;
  remote: RemoteRow[];
  desiredValue: string;
  ashedAllianceId: string;
  remoteEventId: string;
  team: string | null;
  memberResult: typeof schema.hqEventMemberResults.$inferSelect | undefined;
  event: typeof schema.hqEvents.$inferSelect;
  leaseToken: string;
}): Promise<Exclude<keyof EventSyncSummary, "status">> {
  const { item, remote, desiredValue, leaseToken } = input;

  if (remote.length > 1) {
    const marked = await markItem(
      item.id,
      { status: "conflict", errorCode: "duplicate_remote" },
      leaseToken,
    );
    return marked ? "conflict" : "pending";
  }
  if (remote.length === 1) {
    const row = remote[0]!;
    if (scoresEqual(row.score, desiredValue)) {
      const marked = await markItem(
        item.id,
        {
          status: "synced",
          remoteRowId: row.id ?? null,
          lastSyncedRevision: item.desiredRevision,
          lastSyncedValueHash: sha256(desiredValue),
          errorCode: null,
        },
        leaseToken,
      );
      return marked ? "synced" : "pending";
    }
    // Remote row exists with a different value — never overwrite.
    const marked = await markItem(
      item.id,
      {
        status: "conflict",
        errorCode: "remote_value_differs",
        remoteRowId: row.id ?? null,
      },
      leaseToken,
    );
    return marked ? "conflict" : "pending";
  }

  // No remote row → POST the projection once.
  const payload: Record<string, unknown> = {
    alliance_id: input.ashedAllianceId,
    event_id: input.remoteEventId,
    member_id: item.memberId,
    member_name: input.memberResult?.memberName ?? null,
    score: Number(desiredValue),
    recorded_date: input.event.startDate,
    ...(input.team ? { team: input.team } : {}),
  };
  try {
    const created = (await base44EntityPost(
      input.connection,
      input.submitEntity,
      payload,
    )) as { id?: string };
    const marked = await markItem(
      item.id,
      {
        status: "synced",
        remoteRowId: created.id ?? null,
        lastSyncedRevision: item.desiredRevision,
        lastSyncedValueHash: sha256(desiredValue),
        errorCode: null,
      },
      leaseToken,
    );
    // Lost the lease after POST: peer may also have written — next run re-reads.
    return marked ? "synced" : "uncertain";
  } catch (error) {
    const code = remoteStatusCode(error);
    // 5xx/timeouts after POST: reply may have been lost — never re-POST
    // blindly; the next run re-reads and binds an unambiguous match.
    const uncertain = code == null || code >= 500;
    const marked = await markItem(
      item.id,
      {
        status: uncertain ? "uncertain" : "failed",
        errorCode: uncertain ? "post_uncertain" : `remote_${code}`,
      },
      leaseToken,
    );
    if (!marked) return "pending";
    return uncertain ? "uncertain" : "failed";
  }
}

async function listRemoteRows(
  connection: ParsedConnection,
  entity: string,
  ashedAllianceId: string,
  remoteEventId: string,
  team: string | null,
): Promise<RemoteRow[] | null> {
  const query: Record<string, unknown> = {
    alliance_id: ashedAllianceId,
    event_id: remoteEventId,
    ...(team ? { team } : {}),
  };
  const rows = await base44Json<RemoteRow[]>(
    connection,
    `/entities/${entity}?q=${encodeURIComponent(JSON.stringify(query))}`,
  ).catch(() => null);
  if (!Array.isArray(rows)) return null;
  if (rows.length >= REMOTE_READ_CAP) return null;
  return rows;
}

async function flagBoardItems(
  actor: EventActor,
  input: { eventId: string; boardIds?: string[] },
  patch: { status: EventSyncItemStatus; errorCode: string },
): Promise<number> {
  const db = getDb();
  const conditions = [
    eq(schema.hqEventSyncItems.allianceId, actor.allianceId),
    eq(schema.hqEventSyncItems.hqEventId, input.eventId),
  ];
  if (input.boardIds?.length) {
    conditions.push(inArray(schema.hqEventSyncItems.boardId, input.boardIds));
  }
  const now = new Date();
  const updated = await db
    .update(schema.hqEventSyncItems)
    .set({
      status: patch.status,
      errorCode: patch.errorCode,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        ...conditions,
        or(
          eq(schema.hqEventSyncItems.status, "pending"),
          eq(schema.hqEventSyncItems.status, "failed"),
          eq(schema.hqEventSyncItems.status, "uncertain"),
        ),
        // Never clear a live lease mid-POST — a concurrent incomplete_read
        // flag would otherwise let a peer reclaim and double-POST.
        or(
          isNull(schema.hqEventSyncItems.leaseExpiresAt),
          lt(schema.hqEventSyncItems.leaseExpiresAt, now),
        ),
      ),
    )
    .returning({ id: schema.hqEventSyncItems.id });
  return updated.length;
}

/**
 * Apply a sync outcome. When `leaseToken` is set, only the lease holder may
 * write — a stale runner must not clear a peer's lease or mark synced after a
 * double-POST race. Returns false when the lease was lost (or the row moved on).
 */
async function markItem(
  itemId: string,
  patch: {
    status: EventSyncItemStatus;
    remoteRowId?: string | null;
    lastSyncedRevision?: number | null;
    lastSyncedValueHash?: string | null;
    errorCode?: string | null;
  },
  leaseToken?: string,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.hqEventSyncItems)
    .set({
      status: patch.status,
      ...(patch.remoteRowId !== undefined ? { remoteRowId: patch.remoteRowId } : {}),
      ...(patch.lastSyncedRevision !== undefined
        ? { lastSyncedRevision: patch.lastSyncedRevision }
        : {}),
      ...(patch.lastSyncedValueHash !== undefined
        ? { lastSyncedValueHash: patch.lastSyncedValueHash }
        : {}),
      errorCode: patch.errorCode ?? null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryAt: patch.status === "synced" ? null : new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    })
    .where(
      leaseToken
        ? and(
            eq(schema.hqEventSyncItems.id, itemId),
            eq(schema.hqEventSyncItems.leaseToken, leaseToken),
            // Still inside the lease window — expired holders must not finish.
            gt(schema.hqEventSyncItems.leaseExpiresAt, new Date()),
          )
        : eq(schema.hqEventSyncItems.id, itemId),
    )
    .returning({ id: schema.hqEventSyncItems.id });
  return updated.length > 0;
}

/** Re-exported for tests: the value pushed remotely for a member result. */
export { eventProjectionValue, resolveEventMemberEvidence };
