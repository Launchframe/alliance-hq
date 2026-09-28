import "server-only";

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  assertVsResultDate,
  normalizeVsResult,
  vsResultInputSchema,
  vsTotalSchema,
  type VsNormalizedResult,
} from "@/lib/vs-performance/match-results.shared";
import {
  loadVsMatchup,
  loadVsMatchDayResultForUpdate,
  loadVsMatchupRowForUpdate,
  loadVsObservation,
  loadVsObservationById,
  listVsObservationsForDate,
  insertVsObservation,
  markVsObservationDisposition,
  markVsOpponentFieldsDirty,
  upsertVsMatchup,
  writeVsMatchDayResult,
} from "@/lib/vs-performance/match-results.repository.server";
import type { AvailabilityTransaction } from "@/lib/time-off/availability.server";
import {
  VS_WEEK_OUTCOMES,
  type VsOpponentField,
  type VsOpponentScores,
} from "@/lib/vs-performance/opponent-info.shared";
import {
  VsPerformanceError,
  isVsCalendarDate,
  vsDatesForWeek,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import { assertVsScope } from "@/lib/vs-performance/vs-scope.server";
import type {
  TrustedVsResultEvidence,
  VsActor,
  VsMatchupView,
  VsSavedDayResult,
} from "@/lib/vs-performance/weekly-view.shared";

function vsResultContentHash(result: VsNormalizedResult): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        totals: result.totals,
        outcome: result.outcome,
        finality: result.finality,
      }),
    )
    .digest("hex");
}

function resultsEquivalent(
  a: VsNormalizedResult,
  b: VsNormalizedResult,
): boolean {
  return vsResultContentHash(a) === vsResultContentHash(b);
}

function canonicalVsSourceRevision(
  value: string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) throw new VsPerformanceError("invalid");
  return `${match[1]}.${(match[2] ?? "").padEnd(9, "0")}Z`;
}

function normalizedFromRow(
  row: Awaited<ReturnType<typeof writeVsMatchDayResult>>,
): VsNormalizedResult {
  return {
    totals:
      row.ourScore != null && row.opponentScore != null
        ? {
            ourScore: BigInt(row.ourScore).toString(),
            opponentScore: BigInt(row.opponentScore).toString(),
          }
        : null,
    outcome: row.outcome,
    finality: row.finality,
  };
}

function savedFromRow(
  row: Awaited<ReturnType<typeof writeVsMatchDayResult>>,
): VsSavedDayResult {
  const normalized = normalizedFromRow(row);
  return {
    id: row.id,
    recordedDate: row.recordedDate,
    totals: normalized.totals,
    outcome: normalized.outcome,
    finality: normalized.finality,
    source: row.source,
    hqConfirmed: row.hqConfirmed === 1,
    version: row.version,
  };
}

export async function saveVsMatchDayResultTx(
  tx: AvailabilityTransaction,
  input: {
    actor: VsActor;
    matchupId: string;
    recordedDate: string;
    expectedVersion: number;
    requestId: string;
    scope: string;
    normalized: VsNormalizedResult;
    hqConfirmed: boolean;
    evidence: TrustedVsResultEvidence;
    markOpponentDirty?: boolean;
  },
): Promise<{
  saved: VsSavedDayResult;
  replayed: boolean;
  previous: VsSavedDayResult | null;
  weekStart: string;
}> {
  const { actor, normalized } = input;
  await lockAllianceAvailability(tx, actor.allianceId);

  const [matchup] = await tx
    .select()
    .from(schema.vsMatchups)
    .where(
      and(
        eq(schema.vsMatchups.id, input.matchupId),
        eq(schema.vsMatchups.allianceId, actor.allianceId),
      ),
    )
    .for("update")
    .limit(1);
  if (!matchup) throw new VsPerformanceError("invalid", 404);
  assertVsScope(actor, matchup.weekStart, input.scope);

  assertVsResultDate(
    matchup.weekStart,
    input.recordedDate,
    getServerCalendarDate(),
    normalized.finality,
  );

  const sourceRevision = canonicalVsSourceRevision(
    input.evidence.sourceRevision,
  );
  const contentHash = vsResultContentHash(normalized);
  const prior = await loadVsObservation(
    tx,
    matchup.id,
    input.recordedDate,
    input.requestId,
    actor.allianceId,
  );
  if (prior) {
    if (
      prior.contentHash !== contentHash ||
      prior.source !== input.evidence.kind
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const head = await loadVsMatchDayResultForUpdate(
      tx,
      matchup.id,
      input.recordedDate,
      actor.allianceId,
    );
    if (!head) throw new VsPerformanceError("stale", 409);
    return {
      saved: savedFromRow(head),
      replayed: true,
      previous: null,
      weekStart: matchup.weekStart,
    };
  }

  if (input.evidence.kind === "ashed_import") {
    const head = await loadVsMatchDayResultForUpdate(
      tx,
      matchup.id,
      input.recordedDate,
      actor.allianceId,
    );
    if (head?.hqConfirmed === 1) {
      const headNormalized = normalizedFromRow(head);
      const disposition =
        headNormalized && !resultsEquivalent(headNormalized, normalized)
          ? "conflict"
          : "applied";
      await insertVsObservation(tx, {
        allianceId: actor.allianceId,
        matchupId: matchup.id,
        recordedDate: input.recordedDate,
        source: input.evidence.kind,
        sourceRef: input.evidence.sourceRef ?? null,
        sourceRevision,
        requestId: input.requestId,
        contentHash,
        snapshot: normalized,
        nativeVersion: head.version,
        disposition,
        actorHqUserId: actor.hqUserId,
      });
      return {
        saved: savedFromRow(head),
        replayed: false,
        previous: null,
        weekStart: matchup.weekStart,
      };
    }
  }

  const previous = await loadVsMatchDayResultForUpdate(
    tx,
    matchup.id,
    input.recordedDate,
    actor.allianceId,
  );
  const head = await writeVsMatchDayResult(tx, {
    allianceId: actor.allianceId,
    matchupId: matchup.id,
    recordedDate: input.recordedDate,
    result: normalized,
    source: input.evidence.kind,
    sourceRef: input.evidence.sourceRef ?? null,
    sourceRevision,
    hqConfirmed: input.hqConfirmed,
    expectedVersion: input.expectedVersion,
    actorHqUserId: actor.hqUserId,
  });

  await insertVsObservation(tx, {
    allianceId: actor.allianceId,
    matchupId: matchup.id,
    recordedDate: input.recordedDate,
    source: input.evidence.kind,
    sourceRef: input.evidence.sourceRef ?? null,
    sourceRevision,
    requestId: input.requestId,
    contentHash,
    snapshot: normalized,
    nativeVersion: head.version,
    disposition: "applied",
    actorHqUserId: actor.hqUserId,
  });

  if (
    input.markOpponentDirty &&
    normalized.finality === "final" &&
    normalized.totals != null
  ) {
    const dayIndex = vsDatesForWeek(matchup.weekStart).indexOf(
      input.recordedDate,
    );
    if (dayIndex >= 0) {
      const field = `day:${dayIndex + 1}` as VsOpponentField;
      const opponentDailyScores: VsOpponentScores = matchup.opponentDailyScores
        ? ([...matchup.opponentDailyScores] as VsOpponentScores)
        : [null, null, null, null, null, null];
      opponentDailyScores[dayIndex] = normalized.totals.opponentScore;
      const owned = new Set<string>(matchup.opponentInfoOwnedFields ?? []);
      owned.add(field);
      await tx
        .update(schema.vsMatchups)
        .set({
          opponentDailyScores,
          opponentInfoOwnedFields: [...owned] as VsOpponentField[],
          version: matchup.version + 1,
          updatedByHqUserId: actor.hqUserId,
          updatedAt: new Date(),
        })
        .where(eq(schema.vsMatchups.id, matchup.id));
      await markVsOpponentFieldsDirty(tx, matchup.id, actor.allianceId, [
        field,
      ]);
    }
  }

  return {
    saved: savedFromRow(head),
    replayed: false,
    previous: previous ? savedFromRow(previous) : null,
    weekStart: matchup.weekStart,
  };
}

export async function saveVsMatchDayResult(input: {
  actor: VsActor;
  matchupId: string;
  recordedDate: string;
  expectedVersion: number;
  requestId: string;
  totals: { ourScore: string; opponentScore: string } | null;
  reportedOutcome: "pending" | "won" | "lost" | null;
  finality: "unconfirmed" | "final";
  scope: string;
  evidence: TrustedVsResultEvidence;
}): Promise<VsSavedDayResult> {
  const { actor } = input;
  if (
    !isVsCalendarDate(input.recordedDate) ||
    typeof input.requestId !== "string" ||
    input.requestId.trim().length === 0 ||
    input.requestId.length > 120
  ) {
    throw new VsPerformanceError("invalid", 400);
  }
  if (
    input.evidence.kind === "reviewed_upload" &&
    !input.evidence.reviewJobId
  ) {
    throw new VsPerformanceError("invalid", 400);
  }
  const parsed = vsResultInputSchema.parse({
    totals: input.totals,
    reportedOutcome: input.reportedOutcome,
    finality: input.finality,
  });
  const normalized = normalizeVsResult(parsed);
  const hqConfirmed =
    input.evidence.kind === "hq_manual" ||
    input.evidence.kind === "reviewed_upload";
  const db = getDb();

  const { saved, replayed, previous, weekStart } = await db.transaction(
    async (tx) => {
      return saveVsMatchDayResultTx(tx, {
        actor,
        matchupId: input.matchupId,
        recordedDate: input.recordedDate,
        expectedVersion: input.expectedVersion,
        requestId: `${actor.hqUserId}:${input.requestId.trim()}`,
        scope: input.scope,
        normalized,
        hqConfirmed,
        evidence: input.evidence,
        markOpponentDirty: hqConfirmed,
      });
    },
  );

  if (hqConfirmed && !replayed) {
    try {
      const { attemptVsOpponentSync } = await import(
        "@/lib/vs-performance/matchup-sync.server"
      );
      await attemptVsOpponentSync(actor, weekStart);
    } catch {
    }
  }

  if (!replayed) {
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.match_day_result_save",
      severity: "update",
      resourceType: "vs_match_day_result",
      resourceId: `${input.matchupId}:${input.recordedDate}`,
      metadata: {
        recordedDate: input.recordedDate,
        previousOutcome: previous?.outcome ?? null,
        previousTotals: previous?.totals ?? null,
        outcome: normalized.outcome,
        totals: normalized.totals,
        finality: normalized.finality,
        source: input.evidence.kind,
      },
    });
  }
  return saved;
}

const matchupIdentitySchema = z
  .object({
    weekStart: vsWeekStartSchema,
    opponentName: z.string().trim().max(120).nullable(),
    opponentTag: z.string().trim().max(24).nullable(),
    opponentServer: z.number().int().positive().max(2_147_483_647).nullable().optional(),
    weekOutcome: z.enum(VS_WEEK_OUTCOMES).optional(),
    opponentScores: z
      .array(
        z
          .object({
            day: z.number().int().min(1).max(6),
            score: vsTotalSchema.nullable(),
          })
          .strict(),
      )
      .max(6)
      .optional(),
    expectedVersion: z.number().int().min(0),
    scope: z.string().min(1),
  })
  .strict();

export async function saveVsMatchupIdentity(
  actor: VsActor,
  input: unknown,
): Promise<VsMatchupView> {
  const body = matchupIdentitySchema.parse(input);
  assertVsScope(actor, body.weekStart, body.scope);
  const weekDays = vsDatesForWeek(body.weekStart);
  const scoreDays = new Set<number>();
  for (const entry of body.opponentScores ?? []) {
    if (scoreDays.has(entry.day)) throw new VsPerformanceError("invalid", 400);
    scoreDays.add(entry.day);
  }
  const db = getDb();
  const { before, after, identityChanged } = await db.transaction(
    async (tx) => {
      await lockAllianceAvailability(tx, actor.allianceId);
      const existing = await loadVsMatchupRowForUpdate(
        tx,
        actor.allianceId,
        body.weekStart,
      );
      if (!existing && body.expectedVersion !== 0) {
        throw new VsPerformanceError("stale", 409);
      }
      const nameValue = body.opponentName?.trim() || null;
      const tagValue = body.opponentTag?.trim() || null;
      const dirtyFields: VsOpponentField[] = [];
      const addOwnedFields: VsOpponentField[] = [];
      if (!existing || existing.opponentName !== nameValue) {
        dirtyFields.push("opponentName");
        addOwnedFields.push("opponentName");
      }
      if (!existing || existing.opponentTag !== tagValue) {
        dirtyFields.push("opponentTag");
        addOwnedFields.push("opponentTag");
      }
      let opponentDailyScores: VsOpponentScores | undefined;
      if (body.opponentScores !== undefined) {
        opponentDailyScores = existing
          ? ([...existing.opponentDailyScores] as VsOpponentScores)
          : [null, null, null, null, null, null];
        const matchupId = existing?.id;
        for (const entry of body.opponentScores) {
          if (matchupId) {
            const head = await loadVsMatchDayResultForUpdate(
              tx,
              matchupId,
              weekDays[entry.day - 1]!,
              actor.allianceId,
            );
            if (head && head.finality === "final" && head.hqConfirmed === 1 && head.ourScore != null && head.opponentScore != null) {
              throw new VsPerformanceError("confirmed_day", 409);
            }
          }
          if (opponentDailyScores[entry.day - 1] === entry.score) continue;
          opponentDailyScores[entry.day - 1] = entry.score;
          const field = `day:${entry.day}` as VsOpponentField;
          dirtyFields.push(field);
          addOwnedFields.push(field);
        }
      }
      if (
        body.opponentServer !== undefined &&
        body.opponentServer !== (existing?.opponentServer ?? null)
      ) {
        dirtyFields.push("opponentServer");
        addOwnedFields.push("opponentServer");
      }
      if (
        body.weekOutcome !== undefined &&
        body.weekOutcome !== (existing?.weekOutcome ?? "pending")
      ) {
        dirtyFields.push("weekOutcome");
        addOwnedFields.push("weekOutcome");
      }
      const matchup = await upsertVsMatchup(tx, {
        allianceId: actor.allianceId,
        weekStart: body.weekStart,
        opponentName: body.opponentName?.trim() || null,
        opponentTag: body.opponentTag?.trim() || null,
        ...(body.opponentServer !== undefined
          ? { opponentServer: body.opponentServer }
          : {}),
        ...(body.weekOutcome !== undefined
          ? { weekOutcome: body.weekOutcome }
          : {}),
        ...(opponentDailyScores !== undefined
          ? { opponentDailyScores }
          : {}),
        addOwnedFields,
        identitySource: "hq_manual",
        expectedVersion: body.expectedVersion,
        actorHqUserId: actor.hqUserId,
      });
      await markVsOpponentFieldsDirty(
        tx,
        matchup.id,
        actor.allianceId,
        dirtyFields,
      );
      const before = existing
        ? { opponentName: existing.opponentName, opponentTag: existing.opponentTag, opponentServer: existing.opponentServer, weekOutcome: existing.weekOutcome, opponentDailyScores: existing.opponentDailyScores }
        : null;
      const after = {
        opponentName: matchup.opponentName,
        opponentTag: matchup.opponentTag,
        opponentServer: matchup.opponentServer,
        weekOutcome: matchup.weekOutcome,
        opponentDailyScores: matchup.opponentDailyScores,
      };
      const identityChanged =
        matchup.version !== existing?.version;
      if (identityChanged) {
        const identityHash = createHash("sha256")
          .update(JSON.stringify({ before, after }))
          .digest("hex");
        await insertVsObservation(tx, {
          allianceId: actor.allianceId,
          matchupId: matchup.id,
          recordedDate: null,
          source: "hq_manual",
          sourceRef: null,
          requestId: `identity:${actor.hqUserId}:${identityHash.slice(0, 20)}`,
          contentHash: identityHash,
          snapshot: {
            kind: "identity",
            opponentName: after.opponentName,
            opponentTag: after.opponentTag,
            externalOpponentId: matchup.externalOpponentId,
            externalCompetitionId: matchup.externalCompetitionId,
          },
          nativeVersion: matchup.version,
          disposition: "applied",
          actorHqUserId: actor.hqUserId,
        });
      }
      return { before, after, identityChanged };
    },
  );
  await writeTrainsOfficerAudit({
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.matchup_identity_save",
    severity: "update",
    resourceType: "vs_matchup",
    resourceId: `${actor.allianceId}:${body.weekStart}`,
    metadata: {
      weekStart: body.weekStart,
      previousOpponentName: before?.opponentName ?? null,
      previousOpponentTag: before?.opponentTag ?? null,
      opponentName: after.opponentName,
      opponentTag: after.opponentTag,
      previous: before,
      next: after,
      changed: identityChanged,
    },
  });
  const view = await loadVsMatchup(actor.allianceId, body.weekStart);
  if (!view) throw new VsPerformanceError("invalid", 500);
  return view;
}

export async function applyVerifiedVsMatchupSnapshot(
  actor: VsActor,
  input: {
    weekStart: string;
    opponent: {
      externalId?: string | null;
      competitionId?: string | null;
      name?: string | null;
      tag?: string | null;
    };
    days: Array<{
      recordedDate: string;
      totals: { ourScore: string; opponentScore: string } | null;
      reportedOutcome: "pending" | "won" | "lost" | null;
      finality: "unconfirmed" | "final";
      sourceRef?: string | null;
      sourceUpdatedAt?: string | null;
    }>;
  },
): Promise<VsMatchupView> {
  const weekStart = vsWeekStartSchema.parse(input.weekStart);
  const today = getServerCalendarDate();
  const seen = new Set<string>();
  const normalizedDays = input.days.map((day) => {
    const normalized = normalizeVsResult({
      totals: day.totals,
      reportedOutcome: day.reportedOutcome,
      finality: day.finality,
    });
    assertVsResultDate(
      weekStart,
      day.recordedDate,
      today,
      normalized.finality,
    );
    if (seen.has(day.recordedDate)) throw new VsPerformanceError("invalid");
    seen.add(day.recordedDate);
    return {
      ...day,
      normalized,
      sourceRevision: canonicalVsSourceRevision(day.sourceUpdatedAt),
    };
  });

  const db = getDb();
  const { matchupId, changed } = await db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    const existing = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      weekStart,
    );
    if (
      existing?.externalOpponentId &&
      input.opponent.externalId &&
      existing.externalOpponentId !== input.opponent.externalId
    ) {
      throw new VsPerformanceError("opponentMismatch", 409);
    }

    const upstreamOwned = existing?.identitySource !== "hq_manual";
    const merged = {
      opponentName: upstreamOwned
        ? (input.opponent.name ?? existing?.opponentName ?? null)
        : (existing?.opponentName ?? input.opponent.name ?? null),
      opponentTag: upstreamOwned
        ? (input.opponent.tag ?? existing?.opponentTag ?? null)
        : (existing?.opponentTag ?? input.opponent.tag ?? null),
      externalOpponentId:
        input.opponent.externalId ?? existing?.externalOpponentId ?? null,
      externalCompetitionId:
        input.opponent.competitionId ??
        existing?.externalCompetitionId ??
        null,
    };
    const identityChanged =
      !existing ||
      merged.opponentName !== existing.opponentName ||
      merged.opponentTag !== existing.opponentTag ||
      merged.externalOpponentId !== existing.externalOpponentId ||
      merged.externalCompetitionId !== existing.externalCompetitionId;

    let matchup = existing;
    let changed = false;
    if (identityChanged) {
      matchup = await upsertVsMatchup(tx, {
        allianceId: actor.allianceId,
        weekStart,
        ...merged,
        identitySource:
          existing?.identitySource === "hq_manual"
            ? "hq_manual"
            : "ashed_import",
        actorHqUserId: actor.hqUserId,
      });
      const identityHash = createHash("sha256")
        .update(JSON.stringify(merged))
        .digest("hex");
      await insertVsObservation(tx, {
        allianceId: actor.allianceId,
        matchupId: matchup.id,
        recordedDate: null,
        source: "ashed_import",
        sourceRef: null,
        requestId: `identity:${identityHash.slice(0, 24)}`,
        contentHash: identityHash,
        snapshot: { kind: "identity", ...merged },
        nativeVersion: matchup.version,
        disposition: "applied",
        actorHqUserId: actor.hqUserId,
      });
      changed = true;
    }
    if (!matchup) throw new VsPerformanceError("invalid", 500);

    for (const day of normalizedDays) {
      const { normalized } = day;
      const revision = day.sourceRevision;
      const contentHash = vsResultContentHash(normalized);
      const requestId = `ashed:${day.recordedDate}:${createHash("sha256")
        .update(JSON.stringify({ contentHash, revision }))
        .digest("hex")
        .slice(0, 24)}`;
      const prior = await loadVsObservation(
        tx,
        matchup.id,
        day.recordedDate,
        requestId,
        actor.allianceId,
      );
      if (prior) continue;

      const head = await loadVsMatchDayResultForUpdate(
        tx,
        matchup.id,
        day.recordedDate,
        actor.allianceId,
      );
      const headNormalized = head ? normalizedFromRow(head) : null;
      const headRevision = head?.sourceRevision ?? null;
      const observedAt = revision ? new Date(revision) : undefined;

      const recordObservation = async (input2: {
        disposition: "applied" | "conflict" | "superseded";
        nativeVersion: number;
      }) => {
        await insertVsObservation(tx, {
          allianceId: actor.allianceId,
          matchupId: matchup.id,
          recordedDate: day.recordedDate,
          source: "ashed_import",
          sourceRef: day.sourceRef ?? null,
          sourceRevision: revision,
          requestId,
          contentHash,
          snapshot: normalized,
          nativeVersion: input2.nativeVersion,
          disposition: input2.disposition,
          actorHqUserId: actor.hqUserId,
          observedAt,
        });
      };

      if (headNormalized && resultsEquivalent(headNormalized, normalized)) {
        if (revision && (!headRevision || revision > headRevision)) {
          await tx
            .update(schema.vsMatchDayResults)
            .set({
              sourceRevision: revision,
              sourceRef: day.sourceRef ?? null,
              updatedAt: new Date(),
            })
            .where(eq(schema.vsMatchDayResults.id, head!.id));
          changed = true;
        }
        await recordObservation({
          disposition: "applied",
          nativeVersion: head!.version,
        });
        continue;
      }

      if (head && headRevision && revision && revision < headRevision) {
        await recordObservation({
          disposition: "superseded",
          nativeVersion: head.version,
        });
        changed = true;
        continue;
      }

      if (head?.hqConfirmed === 1) {
        const dayObs = await listVsObservationsForDate(
          tx,
          matchup.id,
          day.recordedDate,
          actor.allianceId,
        );
        const latest = dayObs[dayObs.length - 1];
        const stillDeclined =
          latest?.disposition === "reviewed_keep_hq" &&
          latest.contentHash === contentHash &&
          (latest.sourceRevision ?? null) === revision;
        const lastImport = [...dayObs]
          .reverse()
          .find(
            (row) =>
              row.source === "ashed_import" && row.sourceRevision != null,
          );
        const olderThanSeen =
          revision != null &&
          lastImport?.sourceRevision != null &&
          revision < lastImport.sourceRevision;
        await recordObservation({
          disposition:
            stillDeclined || olderThanSeen ? "superseded" : "conflict",
          nativeVersion: head.version,
        });
        changed = true;
        continue;
      }

      if (
        head &&
        head.source === "ashed_import" &&
        (!revision || !headRevision)
      ) {
        await recordObservation({
          disposition: "conflict",
          nativeVersion: head.version,
        });
        changed = true;
        continue;
      }

      const newHead = await writeVsMatchDayResult(tx, {
        allianceId: actor.allianceId,
        matchupId: matchup.id,
        recordedDate: day.recordedDate,
        result: normalized,
        source: "ashed_import",
        sourceRef: day.sourceRef ?? null,
        sourceRevision: revision,
        hqConfirmed: false,
        expectedVersion: head?.version ?? 0,
        actorHqUserId: actor.hqUserId,
      });
      await recordObservation({
        disposition: "applied",
        nativeVersion: newHead.version,
      });
      changed = true;
    }
    return { matchupId: matchup.id, changed };
  });

  if (changed) {
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.matchup_import",
      severity: "update",
      resourceType: "vs_matchup",
      resourceId: matchupId,
      metadata: {
        weekStart,
        days: normalizedDays.map((d) => d.recordedDate),
      },
    });
  }
  const view = await loadVsMatchup(actor.allianceId, weekStart);
  if (!view) throw new VsPerformanceError("invalid", 500);
  return view;
}

const conflictReviewSchema = z
  .object({
    action: z.enum(["keep_hq", "use_ashed"]),
    nativeVersion: z.number().int().min(0),
    scope: z.string().min(1).max(200),
  })
  .strict();

export async function resolveVsMatchConflict(
  actor: VsActor,
  observationId: string,
  input: unknown,
): Promise<VsSavedDayResult> {
  const body = conflictReviewSchema.parse(input);
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    const observation = await loadVsObservationById(
      tx,
      actor.allianceId,
      observationId,
    );
    if (
      !observation ||
      observation.disposition !== "conflict" ||
      observation.recordedDate == null
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const [matchup] = await tx
      .select()
      .from(schema.vsMatchups)
      .where(
        and(
          eq(schema.vsMatchups.id, observation.matchupId),
          eq(schema.vsMatchups.allianceId, actor.allianceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!matchup) throw new VsPerformanceError("invalid", 404);
    assertVsScope(actor, matchup.weekStart, body.scope);

    const dayObservations = await listVsObservationsForDate(
      tx,
      observation.matchupId,
      observation.recordedDate,
      actor.allianceId,
    );
    const position = dayObservations.findIndex(
      (row) => row.id === observation.id,
    );
    const newer = dayObservations
      .slice(position + 1)
      .filter((row) => row.disposition !== "superseded");
    if (newer.length > 0) throw new VsPerformanceError("stale", 409);

    const head = await loadVsMatchDayResultForUpdate(
      tx,
      observation.matchupId,
      observation.recordedDate,
      actor.allianceId,
    );
    if (!head || head.version !== body.nativeVersion) {
      throw new VsPerformanceError("stale", 409);
    }

    let result = head;
    let reviewDisposition: "reviewed_keep_hq" | "reviewed_use_ashed";
    let reviewHash: string;
    let reviewSnapshot: VsNormalizedResult;
    if (body.action === "use_ashed") {
      reviewSnapshot = observation.snapshot as VsNormalizedResult;
      result = await writeVsMatchDayResult(tx, {
        allianceId: actor.allianceId,
        matchupId: observation.matchupId,
        recordedDate: observation.recordedDate,
        result: reviewSnapshot,
        source: "ashed_import",
        sourceRef: observation.sourceRef,
        sourceRevision: observation.sourceRevision,
        hqConfirmed: true,
        expectedVersion: body.nativeVersion,
        actorHqUserId: actor.hqUserId,
      });
      reviewDisposition = "reviewed_use_ashed";
      reviewHash = vsResultContentHash(reviewSnapshot);
    } else {
      reviewDisposition = "reviewed_keep_hq";
      reviewHash = observation.contentHash;
      reviewSnapshot = observation.snapshot as VsNormalizedResult;
    }
    await insertVsObservation(tx, {
      allianceId: actor.allianceId,
      matchupId: observation.matchupId,
      recordedDate: observation.recordedDate,
      source: observation.source,
      sourceRef: observation.sourceRef,
      sourceRevision: observation.sourceRevision,
      requestId: `review:${observation.id}`,
      contentHash: reviewHash,
      snapshot: reviewSnapshot,
      nativeVersion: result.version,
      disposition: reviewDisposition,
      actorHqUserId: actor.hqUserId,
    });
    await markVsObservationDisposition(tx, observation.id, "superseded");
    return result;
  });

  await writeTrainsOfficerAudit({
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.match_conflict_resolve",
    severity: "override",
    resourceType: "vs_match_observation",
    resourceId: observationId,
    metadata: { action: body.action, recordedDate: saved.recordedDate },
  });
  return savedFromRow(saved);
}
