import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";
import type {
  VsNormalizedResult,
  VsResultSource,
} from "@/lib/vs-performance/match-results.shared";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type {
  VsMatchupView,
  VsSavedDayResult,
} from "@/lib/vs-performance/weekly-view.shared";

export type VsDb = ReturnType<typeof getDb> | AvailabilityTransaction;

type MatchupRow = typeof schema.vsMatchups.$inferSelect;
type DayResultRow = typeof schema.vsMatchDayResults.$inferSelect;
type ObservationRow = typeof schema.vsMatchObservations.$inferSelect;

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
): VsMatchupView {
  return {
    id: matchup.id,
    version: matchup.version,
    opponentName: matchup.opponentName,
    opponentTag: matchup.opponentTag,
    days: days.map(dayResultToView),
    conflicts: conflicts.map((row) => ({
      id: row.id,
      recordedDate: row.recordedDate ?? "",
      result: row.snapshot as VsNormalizedResult,
      nativeVersion: row.nativeVersion,
    })),
  };
}

export async function loadVsMatchup(
  allianceId: string,
  weekStart: string,
  db: VsDb = getDb(),
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
  const [days, observations] = await Promise.all([
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
  return matchupToView(matchup, days, conflicts);
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
      externalOpponentId:
        input.externalOpponentId !== undefined
          ? input.externalOpponentId
          : existing.externalOpponentId,
      externalCompetitionId:
        input.externalCompetitionId !== undefined
          ? input.externalCompetitionId
          : existing.externalCompetitionId,
    };
    if (
      merged.opponentName === existing.opponentName &&
      merged.opponentTag === existing.opponentTag &&
      merged.externalOpponentId === existing.externalOpponentId &&
      merged.externalCompetitionId === existing.externalCompetitionId &&
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
      externalOpponentId: input.externalOpponentId ?? null,
      externalCompetitionId: input.externalCompetitionId ?? null,
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
