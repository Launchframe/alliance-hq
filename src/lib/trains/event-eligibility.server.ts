import "server-only";

import { createHash } from "node:crypto";

/**
 * SHA-256 of the deterministic `fingerprintInput` produced by
 * `buildEventEligibility`. The draw mutation recomputes the eligibility under
 * the write lock and compares fingerprints — a changed event, readiness,
 * roster or availability 409s instead of spinning a stale board.
 */
export function eventEligibilityFingerprint(
  fingerprintInput: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(stableStringify(fingerprintInput))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

import { and, asc, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  EVENT_FAMILY_POLICY,
  EVENT_TARGETS,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";
import {
  eventProjectionValue,
  resolveEventMemberEvidence,
  type EventObservation,
  type ResolvedEventMember,
} from "@/lib/hq-events/evidence-merge.shared";
import { listAllianceMembers } from "@/lib/members/roster.server";
import { listDaySpinExcludedMemberIds } from "@/lib/trains/day-spin-exclusions.server";
import {
  buildEventEligibility,
  type EventEligibility,
  type EventEligibilityInput,
  type EventEligibilityRole,
  type EventEligibilitySourceIdentity,
} from "@/lib/trains/event-eligibility.shared";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { getConductorRecord, type TrainsDb } from "@/lib/trains/repository";
import type { EventScoresRule } from "@/lib/trains/rules/catalog.shared";
import { loadTimeOffAvailability } from "@/lib/time-off/availability.server";

export class EventEligibilityError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EventEligibilityError";
  }
}

export type EventEligibilityActor = {
  allianceId: string;
  hqUserId: string | null;
  sessionId: string | null;
};

type HqEventRow = typeof schema.hqEvents.$inferSelect;
type HqEventBoardRow = typeof schema.hqEventBoards.$inferSelect;

const STORM_TEAM_KEYS = (scope: "A" | "B") => {
  const lower = scope.toLowerCase();
  return new Set([lower, scope, `team_${lower}`, `team-${lower}`]);
};

/** Boards an event_scores rule binds: team scope for Storm, boardKey else all. */
export function boundBoardsForRule(
  boards: readonly HqEventBoardRow[],
  rule: EventScoresRule,
): HqEventBoardRow[] {
  const target = rule.source.target;
  const teamScoped = EVENT_FAMILY_POLICY[target].teamScoped;
  if (teamScoped) {
    const scope = rule.source.teamScope;
    if (scope === "both" || scope == null) return [...boards];
    const keys = STORM_TEAM_KEYS(scope);
    return boards.filter((board) => keys.has(board.boardKey));
  }
  if (rule.source.boardKey) {
    const keyed = boards.filter(
      (board) => board.boardKey === rule.source.boardKey,
    );
    return keyed.length > 0 ? keyed : boards.filter((b) => b.boardKey === "main");
  }
  return boards.filter((board) => board.boardKey === "main").length > 0
    ? boards.filter((board) => board.boardKey === "main")
    : [...boards];
}

function toObservation(
  row: typeof schema.hqEventObservations.$inferSelect,
): EventObservation {
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

export type BoundEventBoards = {
  event: HqEventRow;
  boards: HqEventBoardRow[];
  /** Per-board resolved members, keyed by board id. */
  resultsByBoard: Map<string, ResolvedEventMember[]>;
  readyRevisionsBound: boolean;
  readyRevisions: { boardId: string; readyVersion: number }[];
  emptyBoardConfirmed: boolean;
};

/**
 * Load and resolve the bound occurrence/boards for a rule, tenant-scoped.
 * `ready_sources` on a ready board limits the merge to those evidence batches
 * — classes derived only from omitted sources resolve to `none`.
 */
export async function loadBoundEventBoards(
  actor: Pick<EventEligibilityActor, "allianceId">,
  rule: EventScoresRule,
  options: { db?: TrainsDb; forUpdate?: boolean } = {},
): Promise<BoundEventBoards> {
  const db = options.db ?? getDb();
  const occurrenceId = rule.source.occurrenceId;
  if (!occurrenceId) throw new EventEligibilityError("unbound");

  const [event] = await db
    .select()
    .from(schema.hqEvents)
    .where(
      and(
        eq(schema.hqEvents.id, occurrenceId),
        eq(schema.hqEvents.allianceId, actor.allianceId),
      ),
    )
    .limit(1);
  if (!event) throw new EventEligibilityError("event_not_found");
  const eventTarget =
    event.eventFamily && (EVENT_TARGETS as readonly string[]).includes(event.eventFamily)
      ? (event.eventFamily as EventTarget)
      : event.scoreTarget;
  if (eventTarget !== rule.source.target) {
    throw new EventEligibilityError("event_mismatch");
  }

  let boardsQuery = db
    .select()
    .from(schema.hqEventBoards)
    .where(
      and(
        eq(schema.hqEventBoards.allianceId, actor.allianceId),
        eq(schema.hqEventBoards.hqEventId, event.id),
      ),
    )
    .orderBy(asc(schema.hqEventBoards.id))
    .$dynamic();
  if (options.forUpdate) boardsQuery = boardsQuery.for("update");
  const allBoards = await boardsQuery;
  const boards = boundBoardsForRule(allBoards, rule);
  if (boards.length === 0) throw new EventEligibilityError("unbound");

  const boardIds = boards.map((board) => board.id);
  const observations = boardIds.length
    ? await db
        .select()
        .from(schema.hqEventObservations)
        .where(
          and(
            eq(schema.hqEventObservations.allianceId, actor.allianceId),
            inArray(schema.hqEventObservations.boardId, boardIds),
          ),
        )
    : [];

  const resultsByBoard = new Map<string, ResolvedEventMember[]>();
  for (const board of boards) {
    const allowed =
      board.readySources != null ? new Set(board.readySources) : null;
    const scoped = observations.filter(
      (row) =>
        row.boardId === board.id &&
        (allowed == null || allowed.has(row.batchId)),
    );
    const byMember = new Map<string, EventObservation[]>();
    for (const row of scoped) {
      const list = byMember.get(row.memberId) ?? [];
      list.push(toObservation(row));
      byMember.set(row.memberId, list);
    }
    resultsByBoard.set(
      board.id,
      [...byMember.entries()].map(([memberId, rows]) =>
        resolveEventMemberEvidence(memberId, rows),
      ),
    );
  }

  const readyRevisionsBound = boards.every(
    (board) =>
      board.readyVersion != null &&
      board.readyVersion === board.evidenceVersion,
  );

  return {
    event,
    boards,
    resultsByBoard,
    readyRevisionsBound,
    readyRevisions: boards
      .map((board) => ({
        boardId: board.id,
        readyVersion: board.readyVersion ?? -1,
      }))
      .sort((a, b) => a.boardId.localeCompare(b.boardId)),
    emptyBoardConfirmed: boards.every((board) => board.emptyConfirmed === 1),
  };
}

async function loadRosterContext(
  allianceId: string,
  date: string,
  role: EventEligibilityRole,
  db?: TrainsDb,
): Promise<{
  activeMemberIds: string[];
  memberNames: Map<string, string>;
  exclusions: { memberId: string; reason: string }[];
  lockedConductorId: string | null;
}> {
  const [roster, availability, dayExcludedIds, record] = await Promise.all([
    listAllianceMembers(allianceId),
    loadTimeOffAvailability(allianceId, date).catch(() => ({
      awayMemberIds: new Set<string>(),
    })),
    listDaySpinExcludedMemberIds(allianceId, date, db),
    getConductorRecord(allianceId, date, undefined, db),
  ]);
  const active = roster.filter((member) => member.status === "active");
  const exclusions: { memberId: string; reason: string }[] = [];
  for (const memberId of availability.awayMemberIds) {
    exclusions.push({ memberId, reason: "unavailable" });
  }
  for (const memberId of dayExcludedIds) {
    exclusions.push({ memberId, reason: "day_spin" });
  }
  return {
    activeMemberIds: active.map((member) => member.ashedMemberId),
    memberNames: new Map(
      active.map((member) => [member.ashedMemberId, member.currentName]),
    ),
    exclusions,
    lockedConductorId:
      role === "vip" && record?.lockedAt ? record.conductorMemberId : null,
  };
}

export type EventEligibilityCandidateDto = {
  memberId: string;
  memberName: string | null;
  eventScore: string | null;
  stage: number | null;
  evidenceKind: string;
};

export type EventEligibilityPreview = {
  fingerprint: string | null;
  sourceIdentity: EventEligibilitySourceIdentity;
  readyRevisions: { boardId: string; readyVersion: number }[];
  eligibility:
    | { ok: false; reason: "unbound" | "not_ready" }
    | {
        ok: true;
        candidates: EventEligibilityCandidateDto[];
        groupCounts: Record<string, number>;
        exclusionReasons: Record<string, number>;
        excluded?: { memberId: string; memberName: string | null; reason: string }[];
        cutoff: {
          applied: boolean;
          score: string | null;
          stage: number | null;
          tieExpanded: number;
        };
        shortBoard: boolean;
        scoredBoardSize: number;
        drawableCount: number;
        fallback: {
          available: boolean;
          requiresAcknowledgement: boolean;
          count: number;
        };
        /** Yes-respondent member ids — internal draw pool, not for display. */
        fallbackCandidates: string[];
      };
  /** Bound board revisions at preview time (receipt payload). */
  boardRevisions: {
    boardId: string;
    evidenceVersion: number;
    readyVersion: number | null;
  }[];
};

export function buildEligibilityInput(args: {
  rule: EventScoresRule;
  role: EventEligibilityRole;
  bound: BoundEventBoards;
  roster: Awaited<ReturnType<typeof loadRosterContext>>;
}): EventEligibilityInput {
  const { rule, role, bound, roster } = args;
  const boards = bound.boards;
  const primary = boards[0]!;
  const secondary = boards[1];
  return {
    sourceIdentity: {
      target: rule.source.target,
      seriesId: rule.source.seriesId,
      occurrenceId: rule.source.occurrenceId,
      boardKeys: boards.map((board) => board.boardKey).sort(),
      teamScope: rule.source.teamScope,
    },
    role,
    eligibility: rule.eligibility,
    topN: rule.topN,
    fallback: rule.fallback,
    results: bound.resultsByBoard.get(primary.id) ?? [],
    secondaryResults: secondary
      ? (bound.resultsByBoard.get(secondary.id) ?? [])
      : undefined,
    activeMemberIds: roster.activeMemberIds,
    exclusions: roster.exclusions,
    lockedConductorId: roster.lockedConductorId,
    bound: true,
    readyRevisionsBound: bound.readyRevisionsBound,
    readyRevisions: bound.readyRevisions,
    emptyBoardConfirmed: bound.emptyBoardConfirmed,
  };
}

export function toEligibilityDto(args: {
  eligibility: EventEligibility;
  bound: BoundEventBoards;
  memberNames: Map<string, string>;
  includeExcludedDetail: boolean;
}): EventEligibilityPreview["eligibility"] {
  const { eligibility, bound, memberNames, includeExcludedDetail } = args;
  if (!eligibility.ok) return eligibility;

  const resolvedByMember = new Map<string, ResolvedEventMember>();
  for (const list of bound.resultsByBoard.values()) {
    for (const resolved of list) {
      const existing = resolvedByMember.get(resolved.memberId);
      // Primary board wins; secondary (Storm B) only fills gaps/max.
      if (!existing || (existing.class !== "real" && resolved.class === "real")) {
        resolvedByMember.set(resolved.memberId, resolved);
      }
    }
  }
  const dto = (memberId: string): EventEligibilityCandidateDto => {
    const resolved = resolvedByMember.get(memberId);
    return {
      memberId,
      memberName: memberNames.get(memberId) ?? null,
      eventScore: resolved ? eventProjectionValue(resolved) : null,
      stage: resolved?.stage ?? null,
      evidenceKind: resolved?.class ?? "none",
    };
  };

  return {
    ok: true,
    candidates: eligibility.candidates.map(dto),
    groupCounts: eligibility.groupCounts,
    exclusionReasons: eligibility.exclusionReasons,
    // Named exclusion detail only when the caller holds scores:write.
    ...(includeExcludedDetail
      ? {
          excluded: eligibility.excludedMembers.map((entry) => ({
            memberId: entry.memberId,
            memberName: memberNames.get(entry.memberId) ?? null,
            reason: entry.reason,
          })),
        }
      : {}),
    cutoff: eligibility.cutoff,
    shortBoard: eligibility.shortBoard,
    scoredBoardSize: eligibility.scoredBoardSize,
    drawableCount: eligibility.drawableCount,
    fallback: {
      available: eligibility.fallback.available,
      requiresAcknowledgement: eligibility.fallback.requiresAcknowledgement,
      count: eligibility.fallback.candidates.length,
    },
    fallbackCandidates: [...eligibility.fallback.candidates],
  };
}

export async function previewEventEligibility(
  actor: EventEligibilityActor,
  args: {
    date: string;
    role: EventEligibilityRole;
    rule?: EventScoresRule | null;
    seasonKey?: string | null;
    includeExcludedDetail?: boolean;
    db?: TrainsDb;
    forUpdate?: boolean;
  },
): Promise<EventEligibilityPreview> {
  let rule = args.rule ?? null;
  let seasonKey = args.seasonKey ?? null;
  if (!rule) {
    const { resolveTrainSeasonKey } = await import("@/lib/trains/service");
    seasonKey =
      seasonKey ??
      (await resolveTrainSeasonKey(actor.allianceId, args.db ?? getDb()));
    const dayConfig = await resolveRollDayConfig(actor.allianceId, args.date, seasonKey, {
      db: args.db,
    });
    rule =
      (args.role === "vip" ? dayConfig.vipRule : dayConfig.conductorRule) as
        | EventScoresRule
        | null;
  }
  if (!rule || rule.kind !== "event_scores") {
    return {
      fingerprint: null,
      sourceIdentity: {
        target: (rule?.kind === "event_scores" ? rule.source.target : "warzone-duel"),
        seriesId: null,
        occurrenceId: null,
        boardKeys: [],
        teamScope: null,
      },
      readyRevisions: [],
      boardRevisions: [],
      eligibility: { ok: false, reason: "unbound" },
    };
  }

  let bound: BoundEventBoards;
  try {
    bound = await loadBoundEventBoards(actor, rule, {
      db: args.db,
      forUpdate: args.forUpdate,
    });
  } catch (error) {
    if (
      error instanceof EventEligibilityError &&
      error.code === "unbound"
    ) {
      return {
        fingerprint: null,
        sourceIdentity: {
          target: rule.source.target,
          seriesId: rule.source.seriesId,
          occurrenceId: rule.source.occurrenceId,
          boardKeys: [],
          teamScope: rule.source.teamScope,
        },
        readyRevisions: [],
        boardRevisions: [],
        eligibility: { ok: false, reason: "unbound" },
      };
    }
    throw error;
  }

  const roster = await loadRosterContext(
    actor.allianceId,
    args.date,
    args.role,
    args.db,
  );
  const input = buildEligibilityInput({
    rule,
    role: args.role,
    bound,
    roster,
  });
  const eligibility = buildEventEligibility(input);
  const boardRevisions = bound.boards.map((board) => ({
    boardId: board.id,
    evidenceVersion: board.evidenceVersion,
    readyVersion: board.readyVersion ?? null,
  }));
  return {
    boardRevisions,
    fingerprint:
      eligibility.ok && "fingerprintInput" in eligibility
        ? eventEligibilityFingerprint(eligibility.fingerprintInput)
        : null,
    sourceIdentity: input.sourceIdentity,
    readyRevisions: input.readyRevisions.map((entry) => ({ ...entry })),
    eligibility: toEligibilityDto({
      eligibility,
      bound,
      memberNames: roster.memberNames,
      includeExcludedDetail: args.includeExcludedDetail === true,
    }),
  };
}
