import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";
import type {
  VsNormalizedResult,
  VsResultSource,
} from "@/lib/vs-performance/match-results.shared";
import {
  VS_OPPONENT_FIELDS,
  vsOpponentFieldValue,
  type VsOpponentField,
  type VsOpponentInfo,
} from "@/lib/vs-performance/opponent-info.shared";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import {
  vsOpponentConflictToken,
  vsScope,
} from "@/lib/vs-performance/vs-scope.server";
import type {
  VsActor,
  VsMatchupSyncConflict,
  VsMatchupView,
  VsSavedDayResult,
} from "@/lib/vs-performance/weekly-view.shared";

export type VsDb = ReturnType<typeof getDb> | AvailabilityTransaction;

type MatchupRow = typeof schema.vsMatchups.$inferSelect;
type DayResultRow = typeof schema.vsMatchDayResults.$inferSelect;
type ObservationRow = typeof schema.vsMatchObservations.$inferSelect;
export type VsMatchupSyncRow = typeof schema.vsMatchupAshedSync.$inferSelect;

const VS_OPPONENT_FIELD_SET = new Set<string>(VS_OPPONENT_FIELDS);

export function matchupOpponentInfo(matchup: MatchupRow): VsOpponentInfo {
  return {
    opponentServer: matchup.opponentServer,
    opponentName: matchup.opponentName,
    opponentTag: matchup.opponentTag,
    weekOutcome: matchup.weekOutcome,
    opponentDailyScores: matchup.opponentDailyScores,
  };
}

function syncConflicts(
  matchup: MatchupRow,
  sync: VsMatchupSyncRow | null,
): VsMatchupSyncConflict[] {
  if (!sync || sync.status !== "conflict" || !sync.observedSnapshot) {
    return [];
  }
  const local = matchupOpponentInfo(matchup);
  return sync.conflictFields
    .filter((field) => VS_OPPONENT_FIELD_SET.has(field))
    .map((field) => ({
      field,
      hqValue: vsOpponentFieldValue(local, field as VsOpponentField),
      ashedValue: vsOpponentFieldValue(sync.observedSnapshot!, field as VsOpponentField),
    }));
}

function conflictToken(input: {
  matchup: MatchupRow;
  days: DayResultRow[];
  sync: VsMatchupSyncRow | null;
  scope: string;
}): string | null {
  if (
    input.sync?.status !== "conflict" ||
    !input.sync.observedSnapshot ||
    input.sync.conflictFields.length === 0
  ) {
    return null;
  }
  return vsOpponentConflictToken({
    remote: input.sync.observedSnapshot,
    matchupVersion: input.matchup.version,
    days: input.days.map((day) => [day.id, day.version] as const),
    fields: input.sync.conflictFields,
    scope: input.scope,
  });
}

function dayResultToView(row: DayResultRow): VsSavedDayResult {
  const totals =
    row.ourScore != null && row.opponentScore != null
      ? {
          ourScore: BigInt(row.ourScore).toString(),
          opponentScore: BigInt(row.opponentScore).toString(),
        }
      : null;
  return {
    id: row.id,
    recordedDate: row.recordedDate,
    totals,
    outcome: row.outcome,
    finality: row.finality,
    source: row.source,
    hqConfirmed: row.hqConfirmed === 1,
    version: row.version,
  };
}

export function matchupToView(
  matchup: MatchupRow,
  days: DayResultRow[],
  conflicts: ObservationRow[],
  sync: VsMatchupSyncRow | null = null,
  scope: string | null = null,
): VsMatchupView {
  return {
    id: matchup.id,
    version: matchup.version,
    opponentName: matchup.opponentName,
    opponentTag: matchup.opponentTag,
    opponentServer: matchup.opponentServer,
    opponentDailyScores: matchup.opponentDailyScores,
    weekOutcome: matchup.weekOutcome,
    reportedOurPoints: matchup.reportedOurPoints,
    reportedOpponentPoints: matchup.reportedOpponentPoints,
    reportedPointsAt: matchup.reportedPointsAt?.toISOString() ?? null,
    days: days.map(dayResultToView),
    conflicts: conflicts.map((row) => ({
      id: row.id,
      recordedDate: row.recordedDate ?? "",
      result: row.snapshot as VsNormalizedResult,
      nativeVersion: row.nativeVersion,
    })),
    sync: {
      status: sync?.status ?? "idle",
      errorCode: sync?.errorCode ?? null,
      lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
      conflicts: syncConflicts(matchup, sync),
      conflictToken: scope
        ? conflictToken({ matchup, days, sync, scope })
        : null,
    },
  };
}

export async function loadVsMatchup(
  allianceId: string,
  weekStart: string,
  db: VsDb = getDb(),
  actor?: VsActor | null,
): Promise<VsMatchupView | null> {
  const [matchup] = await db
    .select()
    .from(schema.vsMatchups)
    .where(
      and(
        eq(schema.vsMatchups.allianceId, allianceId),
        eq(schema.vsMatchups.weekStart, weekStart),
      ),
    )
    .limit(1);
  if (!matchup) return null;
  const [days, observations, syncRows] = await Promise.all([
    db
      .select()
      .from(schema.vsMatchDayResults)
      .where(eq(schema.vsMatchDayResults.matchupId, matchup.id))
      .orderBy(asc(schema.vsMatchDayResults.recordedDate)),
    db
      .select()
      .from(schema.vsMatchObservations)
      .where(eq(schema.vsMatchObservations.matchupId, matchup.id))
      .orderBy(asc(schema.vsMatchObservations.sequence)),
    db
      .select()
      .from(schema.vsMatchupAshedSync)
      .where(
        and(
          eq(schema.vsMatchupAshedSync.matchupId, matchup.id),
          eq(schema.vsMatchupAshedSync.allianceId, allianceId),
        ),
      )
      .limit(1),
  ]);
  const headVersionByDate = new Map(
    days.map((day) => [day.recordedDate, day.version] as const),
  );
  const latestByDate = new Map<string, ObservationRow>();
  for (const row of observations) {
    if (row.recordedDate == null || row.disposition === "superseded") continue;
    latestByDate.set(row.recordedDate, row);
  }
  const conflicts = [...latestByDate.values()].filter(
    (row) =>
      row.disposition === "conflict" &&
      row.nativeVersion === headVersionByDate.get(row.recordedDate ?? ""),
  );
  return matchupToView(
    matchup,
    days,
    conflicts,
    syncRows[0] ?? null,
    actor ? vsScope(actor, weekStart) : null,
  );
}

export async function loadVsMatchupRowForUpdate(
  tx: AvailabilityTransaction,
  allianceId: string,
  weekStart: string,
): Promise<MatchupRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsMatchups)
    .where(
      and(
        eq(schema.vsMatchups.allianceId, allianceId),
        eq(schema.vsMatchups.weekStart, weekStart),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function upsertVsMatchup(
  tx: AvailabilityTransaction,
  input: {
    allianceId: string;
    weekStart: string;
    opponentName?: string | null;
    opponentTag?: string | null;
    opponentServer?: number | null;
    opponentDailyScores?: MatchupRow["opponentDailyScores"];
    weekOutcome?: MatchupRow["weekOutcome"];
    reportedOurPoints?: number | null;
    reportedOpponentPoints?: number | null;
    addOwnedFields?: readonly VsOpponentField[];
    externalOpponentId?: string | null;
    externalCompetitionId?: string | null;
    identitySource: "hq_manual" | "ashed_import";
    expectedVersion?: number | null;
    actorHqUserId: string | null;
  },
): Promise<MatchupRow> {
  const existing = await loadVsMatchupRowForUpdate(
    tx,
    input.allianceId,
    input.weekStart,
  );
  const mergeOwned = (current: VsOpponentField[]): VsOpponentField[] => {
    if (!input.addOwnedFields?.length) return current;
    const next = new Set<string>(current);
    for (const field of input.addOwnedFields) next.add(field);
    return [...next] as VsOpponentField[];
  };
  if (existing) {
    if (
      input.expectedVersion != null &&
      existing.version !== input.expectedVersion
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const merged = {
      opponentName:
        input.opponentName !== undefined
          ? input.opponentName
          : existing.opponentName,
      opponentTag:
        input.opponentTag !== undefined
          ? input.opponentTag
          : existing.opponentTag,
      opponentServer:
        input.opponentServer !== undefined
          ? input.opponentServer
          : existing.opponentServer,
      opponentDailyScores:
        input.opponentDailyScores !== undefined
          ? input.opponentDailyScores
          : existing.opponentDailyScores,
      weekOutcome:
        input.weekOutcome !== undefined
          ? input.weekOutcome
          : existing.weekOutcome,
      reportedOurPoints:
        input.reportedOurPoints !== undefined
          ? input.reportedOurPoints
          : existing.reportedOurPoints,
      reportedOpponentPoints:
        input.reportedOpponentPoints !== undefined
          ? input.reportedOpponentPoints
          : existing.reportedOpponentPoints,
      externalOpponentId:
        input.externalOpponentId !== undefined
          ? input.externalOpponentId
          : existing.externalOpponentId,
      externalCompetitionId:
        input.externalCompetitionId !== undefined
          ? input.externalCompetitionId
          : existing.externalCompetitionId,
      opponentInfoOwnedFields: mergeOwned(existing.opponentInfoOwnedFields),
    };
    if (
      merged.opponentName === existing.opponentName &&
      merged.opponentTag === existing.opponentTag &&
      merged.opponentServer === existing.opponentServer &&
      merged.weekOutcome === existing.weekOutcome &&
      merged.reportedOurPoints === existing.reportedOurPoints &&
      merged.reportedOpponentPoints === existing.reportedOpponentPoints &&
      merged.externalOpponentId === existing.externalOpponentId &&
      merged.externalCompetitionId === existing.externalCompetitionId &&
      JSON.stringify(merged.opponentDailyScores) ===
        JSON.stringify(existing.opponentDailyScores) &&
      JSON.stringify([...merged.opponentInfoOwnedFields].sort()) ===
        JSON.stringify([...existing.opponentInfoOwnedFields].sort()) &&
      input.identitySource === existing.identitySource
    ) {
      return existing;
    }
    const [row] = await tx
      .update(schema.vsMatchups)
      .set({
        ...merged,
        identitySource: input.identitySource,
        version: existing.version + 1,
        updatedByHqUserId: input.actorHqUserId,
        updatedAt: new Date(),
      })
      .where(eq(schema.vsMatchups.id, existing.id))
      .returning();
    return row!;
  }
  if (input.expectedVersion != null && input.expectedVersion !== 0) {
    throw new VsPerformanceError("stale", 409);
  }
  const id = nanoid();
  const [row] = await tx
    .insert(schema.vsMatchups)
    .values({
      id,
      allianceId: input.allianceId,
      weekStart: input.weekStart,
      opponentName: input.opponentName ?? null,
      opponentTag: input.opponentTag ?? null,
      opponentServer: input.opponentServer ?? null,
      opponentDailyScores:
        input.opponentDailyScores ??
        ([null, null, null, null, null, null] as MatchupRow["opponentDailyScores"]),
      weekOutcome: input.weekOutcome ?? "pending",
      reportedOurPoints: input.reportedOurPoints ?? null,
      reportedOpponentPoints: input.reportedOpponentPoints ?? null,
      externalOpponentId: input.externalOpponentId ?? null,
      externalCompetitionId: input.externalCompetitionId ?? null,
      opponentInfoOwnedFields: mergeOwned([]),
      identitySource: input.identitySource,
      createdByHqUserId: input.actorHqUserId,
      updatedByHqUserId: input.actorHqUserId,
    })
    .returning();
  return row!;
}

export async function loadVsMatchDayResultForUpdate(
  tx: AvailabilityTransaction,
  matchupId: string,
  recordedDate: string,
  allianceId?: string,
): Promise<DayResultRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsMatchDayResults)
    .where(
      and(
        eq(schema.vsMatchDayResults.matchupId, matchupId),
        eq(schema.vsMatchDayResults.recordedDate, recordedDate),
        ...(allianceId
          ? [eq(schema.vsMatchDayResults.allianceId, allianceId)]
          : []),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function loadVsObservation(
  tx: AvailabilityTransaction,
  matchupId: string,
  recordedDate: string,
  requestId: string,
  allianceId?: string,
): Promise<ObservationRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsMatchObservations)
    .where(
      and(
        eq(schema.vsMatchObservations.matchupId, matchupId),
        eq(schema.vsMatchObservations.recordedDate, recordedDate),
        eq(schema.vsMatchObservations.requestId, requestId),
        ...(allianceId
          ? [eq(schema.vsMatchObservations.allianceId, allianceId)]
          : []),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function loadVsObservationById(
  tx: AvailabilityTransaction,
  allianceId: string,
  observationId: string,
): Promise<ObservationRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsMatchObservations)
    .where(
      and(
        eq(schema.vsMatchObservations.id, observationId),
        eq(schema.vsMatchObservations.allianceId, allianceId),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function listVsObservationsForDate(
  tx: AvailabilityTransaction,
  matchupId: string,
  recordedDate: string,
  allianceId?: string,
): Promise<ObservationRow[]> {
  return tx
    .select()
    .from(schema.vsMatchObservations)
    .where(
      and(
        eq(schema.vsMatchObservations.matchupId, matchupId),
        eq(schema.vsMatchObservations.recordedDate, recordedDate),
        ...(allianceId
          ? [eq(schema.vsMatchObservations.allianceId, allianceId)]
          : []),
      ),
    )
    .orderBy(asc(schema.vsMatchObservations.sequence));
}

export async function insertVsObservation(
  tx: AvailabilityTransaction,
  input: {
    allianceId: string;
    matchupId: string;
    recordedDate: string | null;
    source: VsResultSource;
    sourceRef: string | null;
    sourceRevision?: string | null;
    requestId: string;
    contentHash: string;
    snapshot: ObservationRow["snapshot"];
    nativeVersion: number;
    disposition: ObservationRow["disposition"];
    actorHqUserId: string | null;
    observedAt?: Date;
  },
): Promise<ObservationRow> {
  const [row] = await tx
    .insert(schema.vsMatchObservations)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      matchupId: input.matchupId,
      recordedDate: input.recordedDate,
      source: input.source,
      sourceRef: input.sourceRef,
      sourceRevision: input.sourceRevision ?? null,
      requestId: input.requestId,
      contentHash: input.contentHash,
      snapshot: input.snapshot,
      nativeVersion: input.nativeVersion,
      disposition: input.disposition,
      actorHqUserId: input.actorHqUserId,
      ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    })
    .returning();
  return row!;
}

export async function writeVsMatchDayResult(
  tx: AvailabilityTransaction,
  input: {
    allianceId: string;
    matchupId: string;
    recordedDate: string;
    result: VsNormalizedResult;
    source: VsResultSource;
    sourceRef: string | null;
    sourceRevision?: string | null;
    hqConfirmed: boolean;
    expectedVersion: number;
    actorHqUserId: string | null;
  },
): Promise<DayResultRow> {
  const existing = await loadVsMatchDayResultForUpdate(
    tx,
    input.matchupId,
    input.recordedDate,
  );
  const totals = input.result.totals;
  if (existing) {
    if (existing.version !== input.expectedVersion) {
      throw new VsPerformanceError("stale", 409);
    }
    const [row] = await tx
      .update(schema.vsMatchDayResults)
      .set({
        ourScore: totals?.ourScore ?? null,
        opponentScore: totals?.opponentScore ?? null,
        outcome: input.result.outcome,
        finality: input.result.finality,
        source: input.source,
        sourceRef: input.sourceRef,
        sourceRevision: input.sourceRevision ?? null,
        hqConfirmed: input.hqConfirmed ? 1 : 0,
        version: existing.version + 1,
        recordedByHqUserId: input.actorHqUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.vsMatchDayResults.id, existing.id),
          eq(schema.vsMatchDayResults.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new VsPerformanceError("stale", 409);
    return row;
  }
  if (input.expectedVersion !== 0) throw new VsPerformanceError("stale", 409);
  const [row] = await tx
    .insert(schema.vsMatchDayResults)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      matchupId: input.matchupId,
      recordedDate: input.recordedDate,
      ourScore: totals?.ourScore ?? null,
      opponentScore: totals?.opponentScore ?? null,
      outcome: input.result.outcome,
      finality: input.result.finality,
      source: input.source,
      sourceRef: input.sourceRef,
      sourceRevision: input.sourceRevision ?? null,
      hqConfirmed: input.hqConfirmed ? 1 : 0,
      recordedByHqUserId: input.actorHqUserId,
    })
    .returning();
  return row!;
}

export async function markVsObservationDisposition(
  tx: AvailabilityTransaction,
  observationId: string,
  disposition: ObservationRow["disposition"],
): Promise<void> {
  await tx
    .update(schema.vsMatchObservations)
    .set({ disposition })
    .where(eq(schema.vsMatchObservations.id, observationId));
}

export async function loadVsMatchupSyncRowForUpdate(
  tx: AvailabilityTransaction,
  matchupId: string,
  allianceId: string,
): Promise<VsMatchupSyncRow | null> {
  const [row] = await tx
    .select()
    .from(schema.vsMatchupAshedSync)
    .where(
      and(
        eq(schema.vsMatchupAshedSync.matchupId, matchupId),
        eq(schema.vsMatchupAshedSync.allianceId, allianceId),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function ensureVsMatchupSyncRow(
  tx: AvailabilityTransaction,
  matchupId: string,
  allianceId: string,
): Promise<VsMatchupSyncRow> {
  const existing = await loadVsMatchupSyncRowForUpdate(
    tx,
    matchupId,
    allianceId,
  );
  if (existing) return existing;
  const [row] = await tx
    .insert(schema.vsMatchupAshedSync)
    .values({ matchupId, allianceId })
    .returning();
  return row!;
}

export async function markVsOpponentFieldsDirty(
  tx: AvailabilityTransaction,
  matchupId: string,
  allianceId: string,
  fields: readonly VsOpponentField[],
): Promise<void> {
  if (fields.length === 0) return;
  const [alliance] = await tx
    .select({
      ashedAllianceId: schema.alliances.ashedAllianceId,
      operatingMode: schema.alliances.operatingMode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  if (!alliance?.ashedAllianceId || alliance.operatingMode === "native") {
    return;
  }
  const row = await ensureVsMatchupSyncRow(tx, matchupId, allianceId);
  const dirty = new Set<string>(row.dirtyFields);
  for (const field of fields) dirty.add(field);
  await tx
    .update(schema.vsMatchupAshedSync)
    .set({
      dirtyFields: [...dirty] as VsOpponentField[],
      status:
        row.status === "synced" || row.status === "idle"
          ? "pending"
          : row.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.vsMatchupAshedSync.matchupId, matchupId),
        eq(schema.vsMatchupAshedSync.allianceId, allianceId),
      ),
    );
}
