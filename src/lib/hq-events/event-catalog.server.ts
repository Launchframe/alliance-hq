import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { getDb, schema } from "@/lib/db";
import {
  EVENT_POLICY_VERSION,
  EVENT_TARGETS,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";

export type EventFamily = "warzone" | "frontline" | "seasonal";

const EVENT_TARGET_FAMILY: Record<EventTarget, EventFamily> = {
  "warzone-duel": "warzone",
  "frontline-breakthrough": "frontline",
  seasonal: "seasonal",
  "desert-storm": "seasonal",
  "canyon-storm": "seasonal",
};

type CatalogActor = {
  allianceId: string;
  hqUserId: string | null;
  sessionId: string | null;
};

export class EventCatalogError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EventCatalogError";
  }
}

function asEventTarget(value: string | null | undefined): EventTarget | null {
  return value != null && (EVENT_TARGETS as readonly string[]).includes(value)
    ? (value as EventTarget)
    : null;
}

export type EventCatalogEntry = {
  id: string;
  seriesId: string | null;
  seriesName: string | null;
  name: string;
  target: EventTarget | null;
  scoreTarget: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  policyVersion: number;
  ashedEventId: string | null;
  boardCount: number;
  readyBoards: number;
  resultsCount: number;
  createdAt: string;
};

/** Local paginated/filterable catalog — never provisions remote on read. */
export async function resolveEventCatalog(
  actor: CatalogActor,
  filters: {
    family?: EventFamily | null;
    target?: string | null;
    seriesId?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
    cursor?: string | null;
  },
): Promise<{ events: EventCatalogEntry[]; nextCursor: string | null }> {
  const db = getDb();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const offset =
    filters.cursor != null && Number.isFinite(Number(filters.cursor))
      ? Math.max(Number.parseInt(filters.cursor, 10), 0)
      : 0;

  const conditions = [eq(schema.hqEvents.allianceId, actor.allianceId)];
  if (filters.seriesId) {
    conditions.push(eq(schema.hqEvents.seriesId, filters.seriesId));
  }
  if (filters.target) {
    conditions.push(eq(schema.hqEvents.scoreTarget, filters.target));
  }
  if (filters.from) {
    conditions.push(gte(schema.hqEvents.startDate, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(schema.hqEvents.startDate, filters.to));
  }

  const rows = await db
    .select({
      event: schema.hqEvents,
      seriesName: schema.hqEventSeries.name,
    })
    .from(schema.hqEvents)
    .leftJoin(
      schema.hqEventSeries,
      eq(schema.hqEvents.seriesId, schema.hqEventSeries.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.hqEvents.startDate), asc(schema.hqEvents.id))
    .limit(limit + 1)
    .offset(offset);

  let events = rows.slice(0, limit).map(({ event, seriesName }) => ({
    event,
    seriesName,
    target: asEventTarget(event.eventFamily) ?? asEventTarget(event.scoreTarget),
  }));
  if (filters.family) {
    const family = filters.family;
    events = events.filter(
      ({ target }) => target != null && EVENT_TARGET_FAMILY[target] === family,
    );
  }

  const eventIds = events.map(({ event }) => event.id);
  const boards = eventIds.length
    ? await db
        .select()
        .from(schema.hqEventBoards)
        .where(
          and(
            eq(schema.hqEventBoards.allianceId, actor.allianceId),
            inArray(schema.hqEventBoards.hqEventId, eventIds),
          ),
        )
    : [];
  const resultCounts = eventIds.length
    ? await db
        .select({
          boardId: schema.hqEventMemberResults.boardId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.hqEventMemberResults)
        .where(
          and(
            eq(schema.hqEventMemberResults.allianceId, actor.allianceId),
            inArray(schema.hqEventMemberResults.hqEventId, eventIds),
          ),
        )
        .groupBy(schema.hqEventMemberResults.boardId)
    : [];
  const resultsByBoard = new Map(
    resultCounts.map((row) => [row.boardId, row.count]),
  );

  const statsByEvent = new Map<
    string,
    { boards: number; ready: number; results: number }
  >();
  for (const board of boards) {
    const stats = statsByEvent.get(board.hqEventId) ?? {
      boards: 0,
      ready: 0,
      results: 0,
    };
    stats.boards += 1;
    if (
      board.readyVersion != null &&
      board.readyVersion === board.evidenceVersion
    ) {
      stats.ready += 1;
    }
    stats.results += resultsByBoard.get(board.id) ?? 0;
    statsByEvent.set(board.hqEventId, stats);
  }

  return {
    events: events.map(({ event, seriesName, target }) => {
      const stats = statsByEvent.get(event.id) ?? {
        boards: 0,
        ready: 0,
        results: 0,
      };
      return {
        id: event.id,
        seriesId: event.seriesId,
        seriesName,
        name: event.name,
        target,
        scoreTarget: event.scoreTarget,
        startDate: event.startDate,
        endDate: event.endDate,
        status: event.status,
        policyVersion: event.policyVersion ?? EVENT_POLICY_VERSION,
        ashedEventId: event.ashedEventId,
        boardCount: stats.boards,
        readyBoards: stats.ready,
        resultsCount: stats.results,
        createdAt: event.createdAt.toISOString(),
      };
    }),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  };
}

export type CreateEventOccurrenceInput = {
  /** Existing tenant-owned series to reuse, or omit with `series` to create. */
  seriesId?: string | null;
  series?: { name: string; target: EventTarget } | null;
  name: string;
  startDate: string;
  endDate?: string | null;
  status?: string;
  /** Optional link to an existing Ashed occurrence id — never provisions. */
  ashedEventId?: string | null;
  boards?: { boardKey: string; name?: string; scoreType?: string }[];
};

export type CreatedEventOccurrence = {
  id: string;
  seriesId: string;
  boardIds: string[];
  policyVersion: number;
};

/**
 * Strict allowlisted occurrence create/link. Accepts only the fields above,
 * reuses tenant-owned series, snapshots the current policy version, and
 * creates the initial boards. Remote provisioning never happens here.
 */
export async function createEventOccurrence(
  actor: CatalogActor,
  input: CreateEventOccurrenceInput,
): Promise<CreatedEventOccurrence> {
  if (!input.name || !input.startDate) {
    throw new EventCatalogError("invalid_event");
  }
  if (input.series && !asEventTarget(input.series.target)) {
    throw new EventCatalogError("invalid_target");
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    let series: typeof schema.hqEventSeries.$inferSelect | undefined;
    if (input.seriesId) {
      const [existing] = await tx
        .select()
        .from(schema.hqEventSeries)
        .where(
          and(
            eq(schema.hqEventSeries.id, input.seriesId),
            eq(schema.hqEventSeries.allianceId, actor.allianceId),
          ),
        )
        .limit(1);
      if (!existing) throw new EventCatalogError("series_not_found");
      series = existing;
    } else {
      if (!input.series) throw new EventCatalogError("series_required");
      const seriesId = `evser-${nanoid(14)}`;
      const now = new Date();
      await tx.insert(schema.hqEventSeries).values({
        id: seriesId,
        allianceId: actor.allianceId,
        scoreTarget: input.series.target,
        name: input.series.name,
        description: "",
        eventFamily: input.series.target,
        createdAt: now,
        updatedAt: now,
      });
      const [created] = await tx
        .select()
        .from(schema.hqEventSeries)
        .where(eq(schema.hqEventSeries.id, seriesId))
        .limit(1);
      series = created;
    }
    if (!series) throw new EventCatalogError("series_required");

    const target =
      asEventTarget(series.eventFamily) ?? asEventTarget(series.scoreTarget);
    if (target == null) throw new EventCatalogError("invalid_target");

    const eventId = `evnt-${nanoid(14)}`;
    const now = new Date();
    await tx.insert(schema.hqEvents).values({
      id: eventId,
      allianceId: actor.allianceId,
      seriesId: series.id,
      name: input.name,
      scoreTarget: series.scoreTarget,
      eventFamily: target,
      policyVersion: EVENT_POLICY_VERSION,
      startDate: input.startDate,
      endDate: input.endDate ?? input.startDate,
      status: input.status ?? "active",
      ashedEventId: input.ashedEventId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const boardInputs =
      input.boards && input.boards.length > 0
        ? input.boards
        : [{ boardKey: "main" }];
    const boardIds: string[] = [];
    for (const boardInput of boardInputs) {
      const boardId = `evbrd-${nanoid(14)}`;
      await tx.insert(schema.hqEventBoards).values({
        id: boardId,
        allianceId: actor.allianceId,
        hqEventId: eventId,
        boardKey: boardInput.boardKey,
        name: boardInput.name ?? input.name,
        scoreType: boardInput.scoreType ?? null,
        evidenceVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      boardIds.push(boardId);
    }

    if (input.ashedEventId) {
      await tx.insert(schema.hqEventExternalLinks).values({
        id: `evlnk-${nanoid(14)}`,
        allianceId: actor.allianceId,
        entityKind: "event",
        hqEventId: eventId,
        externalSource: "ashed",
        externalId: input.ashedEventId,
        createdBy: actor.hqUserId,
        createdAt: now,
      });
    }

    await writeOfficerActionAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId,
      action: "event_occurrence_create",
      severity: "routine",
      permission: "hq:events:write",
      resourceType: "hq_event",
      resourceId: eventId,
      resourceName: input.name,
      metadata: { seriesId: series.id, target, boardIds },
    });

    return {
      id: eventId,
      seriesId: series.id,
      boardIds,
      policyVersion: EVENT_POLICY_VERSION,
    };
  });
}
