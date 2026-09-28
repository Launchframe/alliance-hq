import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNotNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "@/lib/db";
import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import {
  fetchAshedOpponentMeta,
  createAshedOpponentMeta,
  loadVsAllianceLink,
  resolveVsOpponentSyncContext,
  revalidateVsOpponentSyncContext,
  updateAshedOpponentMeta,
  vsAshedSyncEligibility,
  type VsOpponentAshedContext,
} from "@/lib/vs-performance/ashed-opponent-sync.server";
import {
  ashedOpponentSnapshotKey,
  buildAshedOpponentCreate,
  buildAshedOpponentUpdate,
  reconcileVsOpponentSnapshot,
  setVsOpponentField,
  vsOpponentFieldValue,
  VS_OPPONENT_FIELDS,
  type AshedOpponentSnapshot,
  type VsOpponentField,
  type VsOpponentInfo,
} from "@/lib/vs-performance/opponent-info.shared";
import {
  ensureVsMatchupSyncRow,
  loadVsMatchDayResultForUpdate,
  loadVsMatchupRowForUpdate,
  matchupOpponentInfo,
  upsertVsMatchup,
  type VsMatchupSyncRow,
} from "@/lib/vs-performance/match-results.repository.server";
import { normalizeVsResult } from "@/lib/vs-performance/match-results.shared";
import { saveVsMatchDayResultTx } from "@/lib/vs-performance/match-results.server";
import {
  VsPerformanceError,
  vsDatesForWeek,
  vsWeekStartSchema,
} from "@/lib/vs-performance/weekly-plan.shared";
import {
  assertVsActorCurrent,
  assertVsActorContextTx,
  assertVsAshedLinkTx,
  assertVsScope,
  vsOpponentConflictToken,
  vsScope,
} from "@/lib/vs-performance/vs-scope.server";
import { loadVsPerformanceWeek } from "@/lib/vs-performance/weekly-plan.server";
import { VsSyncError } from "@/lib/vs-scores/ashed-transport.server";
import type {
  VsActor,
  VsMatchupSyncStatus,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

const SYNC_LEASE_MS = 90_000;
const SYNC_DEADLINE_MS = 45_000;

const dayFieldPattern = /^day:([1-6])$/;

type SyncErrorCode =
  | "failed"
  | "uncertain"
  | "credentials_required"
  | "invalid_snapshot"
  | "conflict"
  | "duplicate_records"
  | "score_too_large"
  | "record_missing";

function syncErrorCode(error: unknown): SyncErrorCode {
  if (error instanceof VsPerformanceError && error.code === "score_too_large") {
    return "score_too_large";
  }
  if (error instanceof VsSyncError) {
    if (error.code === "credentials_required") return "credentials_required";
    if (error.code === "uncertain") return "uncertain";
    if (error.code === "conflict") return "conflict";
    if (error.code === "invalid_snapshot") return "invalid_snapshot";
    return "failed";
  }
  return "failed";
}

function statusForError(code: SyncErrorCode): VsMatchupSyncStatus {
  if (code === "credentials_required" || code === "conflict") return code;
  if (code === "uncertain") return "uncertain";
  return "failed";
}

type SyncLease = {
  matchupId: string;
  matchupVersion: number;
  dirtyFields: VsOpponentField[];
  sync: VsMatchupSyncRow;
  leaseToken: string;
};

async function acquireSyncLease(input: {
  actor: VsActor;
  weekStart: string;
  materialize: boolean;
}): Promise<SyncLease | null> {
  const { actor } = input;
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    await assertVsActorContextTx(tx, actor);
    let matchup = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      input.weekStart,
    );
    if (!matchup) {
      if (!input.materialize) return null;
      matchup = await upsertVsMatchup(tx, {
        allianceId: actor.allianceId,
        weekStart: input.weekStart,
        identitySource: "ashed_import",
        expectedVersion: 0,
        actorHqUserId: actor.hqUserId,
      });
    }
    const sync = await ensureVsMatchupSyncRow(
      tx,
      matchup.id,
      actor.allianceId,
    );
    if (sync.leaseExpiresAt && sync.leaseExpiresAt > new Date()) {
      throw new VsPerformanceError("busy", 409);
    }
    const leaseToken = randomBytes(16).toString("hex");
    const [row] = await tx
      .update(schema.vsMatchupAshedSync)
      .set({
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
        requestedVersion: matchup.version,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.vsMatchupAshedSync.matchupId, matchup.id),
          eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
        ),
      )
      .returning();
    if (!row) throw new VsPerformanceError("busy", 409);
    return {
      matchupId: matchup.id,
      matchupVersion: matchup.version,
      dirtyFields: sync.dirtyFields,
      sync: row,
      leaseToken,
    };
  });
}

async function writeSyncUnderLease(input: {
  matchupId: string;
  allianceId: string;
  leaseToken: string;
  patch: Record<string, unknown>;
  release: boolean;
  failureCode?: SyncErrorCode;
}): Promise<boolean> {
  return getDb().transaction(async tx => {
    const predicate = () => and(
      eq(schema.vsMatchupAshedSync.matchupId, input.matchupId),
      eq(schema.vsMatchupAshedSync.allianceId, input.allianceId),
      eq(schema.vsMatchupAshedSync.leaseToken, input.leaseToken),
      gt(schema.vsMatchupAshedSync.leaseExpiresAt, new Date()),
    );
    const [current] = await tx.select().from(schema.vsMatchupAshedSync).where(predicate()).for("update").limit(1);
    if (!current) return false;
    const patch = input.failureCode ? {
      status: current.status === "uncertain" || current.status === "conflict" ? current.status : statusForError(input.failureCode),
      errorCode: current.errorCode === "create_retry_ready" ? current.errorCode : input.failureCode,
    } : input.patch;
    const updated = await tx.update(schema.vsMatchupAshedSync).set({
      ...patch,
      ...(input.release ? { leaseToken: null, leaseExpiresAt: null } : {}),
      updatedAt: new Date(),
    }).where(predicate()).returning({ matchupId: schema.vsMatchupAshedSync.matchupId });
    return updated.length > 0;
  });
}

async function releaseSyncLease(
  matchupId: string,
  allianceId: string,
  leaseToken: string,
): Promise<void> {
  await writeSyncUnderLease({
    matchupId,
    allianceId,
    leaseToken,
    patch: {},
    release: true,
  });
}

function unownedFields(
  owned: readonly VsOpponentField[],
  dirty: readonly VsOpponentField[],
): Set<VsOpponentField> {
  const blocked = new Set<string>([...owned, ...dirty]);
  return new Set(
    VS_OPPONENT_FIELDS.filter((field) => !blocked.has(field)),
  );
}

async function matchupIdForWeek(
  allianceId: string,
  weekStart: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.vsMatchups.id })
    .from(schema.vsMatchups)
    .where(
      and(
        eq(schema.vsMatchups.allianceId, allianceId),
        eq(schema.vsMatchups.weekStart, weekStart),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function assertSyncWriteGate(input: {
  actor: VsActor;
  weekStart: string;
  matchupId: string;
  matchupVersion: number;
  leaseToken: string;
  ashedAllianceId: string;
  review?: { token: string; remote: AshedOpponentSnapshot; fields: readonly VsOpponentField[]; scope: string };
}): Promise<void> {
  const { actor } = input;
  await assertVsActorCurrent(actor);
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    await assertVsActorContextTx(tx, actor);
    const matchup = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      input.weekStart,
    );
    if (
      !matchup ||
      matchup.id !== input.matchupId ||
      matchup.version !== input.matchupVersion
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const [alliance] = await tx
      .select({
        ashedAllianceId: schema.alliances.ashedAllianceId,
        operatingMode: schema.alliances.operatingMode,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, actor.allianceId))
      .limit(1);
    if (
      !alliance?.ashedAllianceId ||
      alliance.ashedAllianceId !== input.ashedAllianceId ||
      alliance.operatingMode === "native"
    ) {
      throw new VsSyncError("credentials_required");
    }
    const [sync] = await tx
      .select()
      .from(schema.vsMatchupAshedSync)
      .where(
        and(
          eq(schema.vsMatchupAshedSync.matchupId, input.matchupId),
          eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !sync ||
      sync.leaseToken !== input.leaseToken ||
      !sync.leaseExpiresAt ||
      sync.leaseExpiresAt <= new Date()
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    if (input.review) {
      const days = await tx.select({ id: schema.vsMatchDayResults.id, version: schema.vsMatchDayResults.version }).from(schema.vsMatchDayResults).where(and(eq(schema.vsMatchDayResults.matchupId, matchup.id), eq(schema.vsMatchDayResults.allianceId, actor.allianceId)));
      const token = vsOpponentConflictToken({ remote: input.review.remote, matchupVersion: matchup.version, days: days.map(day => [day.id, day.version] as const), fields: sync.conflictFields, scope: input.review.scope });
      if (sync.status !== "conflict" || !sync.observedSnapshot || ashedOpponentSnapshotKey(sync.observedSnapshot) !== ashedOpponentSnapshotKey(input.review.remote) || token !== input.review.token) throw new VsPerformanceError("stale", 409);
    }
  });
}

async function findUniqueWeekRecord(
  context: VsOpponentAshedContext,
  weekStart: string,
): Promise<AshedOpponentSnapshot | null> {
  const rows = await fetchAshedOpponentMeta(context);
  const matches = rows.filter((row) => row.weekStart === weekStart);
  if (matches.length > 1) throw new VsSyncError("conflict");
  return matches[0] ?? null;
}

export async function pullAshedOpponentInfo(
  actor: VsActor,
  weekStartInput: string,
  scopeInput: string,
  reason: "auto" | "refresh" = "refresh",
): Promise<VsWeekPayload> {
  const weekStart = vsWeekStartSchema.parse(weekStartInput);
  assertVsScope(actor, weekStart, scopeInput);
  await assertVsActorCurrent(actor);
  const link = await loadVsAllianceLink(actor.allianceId);
  if (!link) throw new VsPerformanceError("ashed_unavailable", 400);

  const lease = await acquireSyncLease({
    actor,
    weekStart,
    materialize: true,
  });
  if (!lease) throw new VsPerformanceError("busy", 409);
  const matchupId = lease.matchupId;
  const leaseToken = lease.leaseToken;

  try {
  const fail = async (error: unknown) => {
    const code = syncErrorCode(error);
    await writeSyncUnderLease({
      matchupId,
      allianceId: actor.allianceId,
      leaseToken,
      patch: {},
      failureCode: code,
      release: true,
    });
    return loadVsPerformanceWeek(actor.sessionId, weekStart, actor);
  };

  let context: VsOpponentAshedContext;
  try {
    const deadline = Date.now() + SYNC_DEADLINE_MS;
    const resolved = await resolveVsOpponentSyncContext(actor, deadline);
    if (!resolved) throw new VsSyncError("credentials_required");
    context = { ...resolved, deadline };
  } catch (error) {
    return await fail(error);
  }

  let remote: AshedOpponentSnapshot | null;
  let duplicates = false;
  try {
    remote = await findUniqueWeekRecord(context, weekStart);
  } catch (error) {
    if (error instanceof VsSyncError && error.code === "conflict") {
      duplicates = true;
      remote = null;
    } else {
      return await fail(error);
    }
  }

  await assertVsActorCurrent(actor);
  const db = getDb();
  const applied = await db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    await assertVsActorContextTx(tx, actor);
    await assertVsAshedLinkTx(tx, actor.allianceId, context.allianceId);
    const existing = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      weekStart,
    );
    if (!existing || existing.id !== matchupId) return false;
    const sync = await ensureVsMatchupSyncRow(tx, matchupId, actor.allianceId);
    if (
      sync.leaseToken !== leaseToken ||
      !sync.leaseExpiresAt ||
      sync.leaseExpiresAt <= new Date()
    ) {
      return false;
    }
    const dirty = sync.dirtyFields;
    const owned = existing.opponentInfoOwnedFields;
    const baseline = sync.baselineSnapshot ?? null;

    if (duplicates) {
      await tx
        .update(schema.vsMatchupAshedSync)
        .set({
          status: "conflict",
          errorCode: "duplicate_records",
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.vsMatchupAshedSync.matchupId, matchupId),
            eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
          ),
        );
      return true;
    }

    if (!remote) {
      if (existing.externalCompetitionId) {
        await tx.update(schema.vsMatchupAshedSync).set({ status: "conflict", errorCode: "record_missing", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(schema.vsMatchupAshedSync.matchupId, matchupId), eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId)));
        return true;
      }
      const keepUncertain =
        sync.status === "uncertain" && reason !== "refresh";
      if (!keepUncertain) {
        await tx
          .update(schema.vsMatchupAshedSync)
          .set({
            baselineSnapshot: null,
            observedSnapshot: null,
            conflictFields: [],
            status: dirty.length > 0 ? "pending" : "synced",
            errorCode: sync.status === "uncertain" || sync.errorCode === "create_retry_ready" ? "create_retry_ready" : null,
            lastSyncedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.vsMatchupAshedSync.matchupId, matchupId),
              eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
            ),
          );
      } else {
        await tx
          .update(schema.vsMatchupAshedSync)
          .set({
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.vsMatchupAshedSync.matchupId, matchupId),
              eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
            ),
          );
      }
      return true;
    }

    if (
      sync.observedSnapshot &&
      remote.sourceRevision < sync.observedSnapshot.sourceRevision
    ) {
      await tx
        .update(schema.vsMatchupAshedSync)
        .set({
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.vsMatchupAshedSync.matchupId, matchupId),
            eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
          ),
        );
      return true;
    }

    if (
      existing.externalCompetitionId &&
      remote.remoteId !== existing.externalCompetitionId
    ) {
      await tx
        .update(schema.vsMatchupAshedSync)
        .set({
          observedSnapshot: remote,
          conflictFields: [...VS_OPPONENT_FIELDS],
          status: "conflict",
          errorCode: "record_missing",
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.vsMatchupAshedSync.matchupId, matchupId),
            eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
          ),
        );
      return true;
    }

    const free = unownedFields(owned, dirty);
    const protectedDates: string[] = [];
    for (const field of VS_OPPONENT_FIELDS) {
      const match = dayFieldPattern.exec(field);
      if (!match || !free.has(field)) continue;
      const head = await loadVsMatchDayResultForUpdate(
        tx,
        existing.id,
        vsDatesForWeek(weekStart)[Number(match[1]) - 1]!,
        actor.allianceId,
      );
      if (head && head.finality === "final" && head.hqConfirmed === 1 && head.ourScore != null && head.opponentScore != null) {
        protectedDates.push(head.recordedDate);
        free.delete(field);
      }
    }

    const localInfo = matchupOpponentInfo(existing);
    let next: VsOpponentInfo = localInfo;
    for (const field of free) {
      next = setVsOpponentField(next, field, remote);
    }

    const conflicts: VsOpponentField[] = [];
    for (const field of VS_OPPONENT_FIELDS) {
      if (free.has(field)) continue;
      const remoteValue = vsOpponentFieldValue(remote, field);
      if (remoteValue === vsOpponentFieldValue(localInfo, field)) continue;
      const isDirty = dirty.includes(field);
      if (sync.status === "conflict" && sync.conflictFields.includes(field)) {
        conflicts.push(field);
        continue;
      }
      if (
        isDirty &&
        baseline &&
        remoteValue === vsOpponentFieldValue(baseline, field)
      ) {
        continue;
      }
      const dayMatch = dayFieldPattern.exec(field);
      const confirmedProtected = dayMatch
        ? protectedDates.includes(
            vsDatesForWeek(weekStart)[Number(dayMatch[1]) - 1]!,
          )
        : false;
      if (isDirty || owned.includes(field) || confirmedProtected) {
        conflicts.push(field);
      }
    }

    const matchup = await upsertVsMatchup(tx, {
      allianceId: actor.allianceId,
      weekStart,
      opponentName: next.opponentName,
      opponentTag: next.opponentTag,
      opponentServer: next.opponentServer,
      opponentDailyScores: next.opponentDailyScores,
      weekOutcome: next.weekOutcome,
      ...(existing.externalCompetitionId
        ? {}
        : { externalCompetitionId: remote.remoteId }),
      identitySource: existing.identitySource,
      actorHqUserId: actor.hqUserId,
    });
    void matchup;
    const hasConflict = conflicts.length > 0;
    await tx
      .update(schema.vsMatchupAshedSync)
      .set({
        ...(hasConflict ? {} : { baselineSnapshot: remote }),
        observedSnapshot: remote,
        conflictFields: conflicts,
        status: hasConflict
          ? "conflict"
          : dirty.length > 0
            ? "pending"
            : "synced",
        errorCode: null,
        lastSyncedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.vsMatchupAshedSync.matchupId, matchupId),
          eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
        ),
      );
    return true;
  });
  void applied;

  if (remote) {
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.matchup_pull",
      severity: "update",
      resourceType: "vs_matchup",
      resourceId: `${actor.allianceId}:${weekStart}`,
      metadata: { weekStart, remoteId: remote.remoteId },
    });
  }
  return await loadVsPerformanceWeek(actor.sessionId, weekStart, actor);
  } finally {
    await releaseSyncLease(matchupId, actor.allianceId, leaseToken);
  }
}

const syncRequestSchema = z
  .object({
    weekStart: vsWeekStartSchema,
    scope: z.string().min(1).max(200),
    resolution: z.enum(["keep_hq", "use_ashed"]).optional(),
    conflictToken: z.string().min(1).max(200).optional(),
    reason: z.enum(["auto", "refresh", "sync"]).default("sync"),
  })
  .strict();

export function syncAshedOpponentInfo(actor: VsActor, input: unknown): Promise<VsWeekPayload>;
export function syncAshedOpponentInfo(actor: VsActor, input: unknown, render: false): Promise<null>;
export async function syncAshedOpponentInfo(
  actor: VsActor,
  input: unknown,
  render = true,
): Promise<VsWeekPayload | null> {
  const body = syncRequestSchema.parse(input);
  const { weekStart, scope } = body;
  assertVsScope(actor, weekStart, scope);
  await assertVsActorCurrent(actor);
  const link = await loadVsAllianceLink(actor.allianceId);
  if (!link) throw new VsPerformanceError("ashed_unavailable", 400);

  const lease = await acquireSyncLease({
    actor,
    weekStart,
    materialize: false,
  });
  if (!lease) {
    const payload = await pullAshedOpponentInfo(actor, weekStart, scope, body.reason === "auto" ? "auto" : "refresh");
    return render ? payload : null;
  }
  const matchupId = lease.matchupId;
  const leaseToken = lease.leaseToken;
  let publishedVersion = lease.matchupVersion;
  try {
  const done = () => render ? loadVsPerformanceWeek(actor.sessionId, weekStart, actor) : Promise.resolve(null);

  const fail = async (error: unknown) => {
    const code = syncErrorCode(error);
    await writeSyncUnderLease({
      matchupId,
      allianceId: actor.allianceId,
      leaseToken,
      patch: {},
      failureCode: code,
      release: true,
    });
    return await done();
  };

  let context: VsOpponentAshedContext;
  try {
    const deadline = Date.now() + SYNC_DEADLINE_MS;
    const resolved = await resolveVsOpponentSyncContext(actor, deadline);
    if (!resolved) throw new VsSyncError("credentials_required");
    context = { ...resolved, deadline };
  } catch (error) {
    return await fail(error);
  }

  const db = getDb();
  const stage = await db.transaction(async (tx) => {
    const matchup = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      weekStart,
    );
    if (!matchup) throw new VsPerformanceError("stale", 409);
    const sync = await ensureVsMatchupSyncRow(
      tx,
      matchup.id,
      actor.allianceId,
    );
    if (
      sync.leaseToken !== leaseToken ||
      !sync.leaseExpiresAt ||
      sync.leaseExpiresAt <= new Date()
    ) {
      throw new VsPerformanceError("busy", 409);
    }
    const days = await tx
      .select()
      .from(schema.vsMatchDayResults)
      .where(eq(schema.vsMatchDayResults.matchupId, matchup.id));
    return { matchup, sync, days };
  });
  const { matchup, sync } = stage;
  publishedVersion = matchup.version;
  const desired = matchupOpponentInfo(matchup);

  const finish = async (result: {
    status: VsMatchupSyncStatus;
    errorCode?: string | null;
    baseline?: AshedOpponentSnapshot | null;
    observed?: AshedOpponentSnapshot | null;
    conflicts?: VsOpponentField[];
    pushed?: VsOpponentField[];
    clearDirty?: VsOpponentField[];
    bindRemoteId?: string;
  }): Promise<boolean> => {
    return db.transaction(async (tx) => {
      await lockAllianceAvailability(tx, actor.allianceId);
      await assertVsActorContextTx(tx, actor);
      await assertVsAshedLinkTx(tx, actor.allianceId, context.allianceId);
      const current = await loadVsMatchupRowForUpdate(
        tx,
        actor.allianceId,
        weekStart,
      );
      if (!current) return false;
      const syncRow = await ensureVsMatchupSyncRow(
        tx,
        matchupId,
        actor.allianceId,
      );
      if (
        syncRow.leaseToken !== leaseToken ||
        !syncRow.leaseExpiresAt ||
        syncRow.leaseExpiresAt <= new Date()
      ) {
        return false;
      }
      const desiredNow = matchupOpponentInfo(current);
      let dirtyFields = syncRow.dirtyFields;
      const cleared = new Set<VsOpponentField>();
      for (const field of result.pushed ?? []) {
        cleared.add(field);
      }
      for (const field of result.clearDirty ?? []) {
        cleared.add(field);
      }
      if (cleared.size > 0 && current.version === publishedVersion) {
        dirtyFields = dirtyFields.filter(field => !cleared.has(field) || vsOpponentFieldValue(desiredNow, field) !== vsOpponentFieldValue(desired, field));
      }
      let baseline = result.baseline;
      let conflicts = result.conflicts;
      if (result.status === "synced" && result.observed) {
        const reconciled = reconcileVsOpponentSnapshot({
          local: desiredNow,
          remote: result.observed,
          baseline: syncRow.baselineSnapshot,
          owned: current.opponentInfoOwnedFields,
          dirty: dirtyFields,
          unresolved: syncRow.conflictFields,
          acknowledged: [...cleared],
        });
        baseline = reconciled.baseline;
        conflicts = reconciled.conflicts;
        await upsertVsMatchup(tx, {
          allianceId: actor.allianceId,
          weekStart,
          ...reconciled.local,
          ...(result.bindRemoteId ? { externalCompetitionId: result.bindRemoteId } : {}),
          identitySource: current.identitySource,
          expectedVersion: current.version,
          actorHqUserId: actor.hqUserId,
        });
      }
      const remaining = dirtyFields;
      const status = result.status === "synced"
        ? conflicts?.length ? "conflict" : remaining.length > 0 ? "pending" : "synced"
        : result.status;
      const publishedWholeVersion = result.status === "synced" && sync.dirtyFields.every(field => cleared.has(field));
      await tx
        .update(schema.vsMatchupAshedSync)
        .set({
          status,
          errorCode: result.errorCode ?? null,
          ...(baseline !== undefined ? { baselineSnapshot: baseline } : {}),
          ...(result.observed !== undefined
            ? { observedSnapshot: result.observed }
            : {}),
          ...(conflicts !== undefined ? { conflictFields: conflicts } : {}),
          dirtyFields: remaining,
          processedVersion: publishedWholeVersion ? publishedVersion : syncRow.processedVersion,
          leaseToken: null,
          leaseExpiresAt: null,
          lastSyncedAt:
            status === "synced" || status === "pending"
              ? new Date()
              : syncRow.lastSyncedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.vsMatchupAshedSync.matchupId, matchupId),
            eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
          ),
        );
      return true;
    });
  };

  if (
    sync.status === "conflict" &&
    sync.observedSnapshot &&
    sync.conflictFields.length > 0
  ) {
    if (!body.resolution) {
      await releaseSyncLease(matchupId, actor.allianceId, leaseToken);
      return await done();
    }
    const reviewed = sync.observedSnapshot;
    const token = vsOpponentConflictToken({
      remote: reviewed,
      matchupVersion: matchup.version,
      days: stage.days.map((d) => [d.id, d.version] as const),
      fields: sync.conflictFields,
      scope,
    });
    if (body.conflictToken !== token) {
      await releaseSyncLease(matchupId, actor.allianceId, leaseToken);
      throw new VsPerformanceError("stale", 409);
    }
    let fresh: AshedOpponentSnapshot | null;
    try {
      await revalidateVsOpponentSyncContext(actor, context);
      fresh = await findUniqueWeekRecord(context, weekStart);
    } catch (error) {
      return await fail(error);
    }
    if (
      !fresh ||
      fresh.remoteId !== reviewed.remoteId ||
      ashedOpponentSnapshotKey(fresh) !== ashedOpponentSnapshotKey(reviewed)
    ) {
      await finish({
        status: "conflict",
        errorCode: fresh ? null : "record_missing",
        ...(fresh ? { observed: fresh } : {}),
      });
      throw new VsPerformanceError("stale", 409);
    }
    if (body.resolution === "use_ashed") {
      const applied = await applyObservedAshedValues({
        actor,
        weekStart,
        scope,
        remote: fresh,
        conflictFields: sync.conflictFields,
        conflictToken: body.conflictToken!,
        leaseToken,
        matchupId,
      });
      if (applied) {
        await writeTrainsOfficerAudit({
          sessionId: actor.sessionId,
          allianceId: actor.allianceId,
          hqUserId: actor.hqUserId ?? undefined,
          action: "vs.matchup_sync_resolve",
          severity: "override",
          resourceType: "vs_matchup",
          resourceId: `${actor.allianceId}:${weekStart}`,
          metadata: { weekStart, resolution: body.resolution },
        });
        return await done();
      }
      return await done();
    }
    const keepFields = [...sync.conflictFields];
    let update: ReturnType<typeof buildAshedOpponentUpdate>;
    try {
      update = buildAshedOpponentUpdate({
        current: fresh,
        baseline: fresh,
        desired,
        dirtyFields: keepFields,
      });
    } catch (error) {
      return await fail(error);
    }
    if (update.conflicts.length > 0) {
      await finish({
        status: "conflict",
        observed: fresh,
        conflicts: update.conflicts,
      });
      return await done();
    }
    if (Object.keys(update.patch).length > 0) {
      try {
        await assertSyncWriteGate({
          actor,
          weekStart,
          matchupId,
          matchupVersion: matchup.version,
          leaseToken,
          ashedAllianceId: link.ashedAllianceId,
          review: { token: body.conflictToken!, remote: fresh, fields: keepFields, scope },
        });
      } catch (error) {
        return await fail(error);
      }
      try {
        await updateAshedOpponentMeta(context, fresh.remoteId, update.patch);
      } catch (error) {
        return await fail(error);
      }
    }
    let readBack: AshedOpponentSnapshot | null;
    try {
      readBack = await findUniqueWeekRecord(context, weekStart);
    } catch (error) {
      return await fail(error);
    }
    if (!readBack || readBack.remoteId !== fresh.remoteId) {
      return await fail(new VsSyncError("uncertain"));
    }
    const mismatched = keepFields.filter(
      (field) =>
        vsOpponentFieldValue(readBack!, field) !==
        vsOpponentFieldValue(desired, field),
    );
    if (mismatched.length > 0) {
      await finish({
        status: "conflict",
        observed: readBack,
        conflicts: mismatched,
      });
      return await done();
    }
    await finish({
      status: "synced",
      baseline: readBack,
      observed: readBack,
      conflicts: [],
      clearDirty: keepFields,
      bindRemoteId: readBack.remoteId,
    });
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.matchup_sync_resolve",
      severity: "override",
      resourceType: "vs_matchup",
      resourceId: `${actor.allianceId}:${weekStart}`,
      metadata: { weekStart, resolution: "keep_hq" },
    });
    return await done();
  }
  if (body.resolution) {
    await releaseSyncLease(matchupId, actor.allianceId, leaseToken);
    throw new VsPerformanceError("stale", 409);
  }

  if (sync.status === "uncertain") {
    let remote: AshedOpponentSnapshot | null;
    try {
      remote = await findUniqueWeekRecord(context, weekStart);
    } catch (error) {
      return await fail(error);
    }
    if (!remote) {
      if (body.reason === "refresh") {
        await finish({ status: "pending", observed: null, errorCode: "create_retry_ready" });
      } else {
        await finish({ status: "uncertain", errorCode: "record_missing" });
      }
      return await done();
    }
    const recoveringCreate = !matchup.externalCompetitionId && !sync.baselineSnapshot;
    if (!recoveringCreate && remote.remoteId === matchup.externalCompetitionId) {
      const recovery = buildAshedOpponentUpdate({ current: remote, baseline: sync.baselineSnapshot, desired, dirtyFields: sync.dirtyFields });
      if (recovery.conflicts.length) {
        await finish({ status: "conflict", observed: remote, conflicts: recovery.conflicts });
      } else {
        const acknowledged = sync.dirtyFields.filter(field => vsOpponentFieldValue(remote!, field) === vsOpponentFieldValue(desired, field));
        await finish({ status: "synced", baseline: remote, observed: remote, conflicts: [], pushed: acknowledged });
      }
      return await done();
    }
    const mismatched = VS_OPPONENT_FIELDS.filter(
      (field) =>
        vsOpponentFieldValue(remote!, field) !==
        vsOpponentFieldValue(desired, field),
    );
    if (
      recoveringCreate && remote.compatibilityScore !== "0" ||
      (matchup.externalCompetitionId &&
        remote.remoteId !== matchup.externalCompetitionId)
    ) {
      await finish({
        status: "conflict",
        observed: remote,
        conflicts: mismatched,
        errorCode: "record_missing",
      });
      return await done();
    }
    if (mismatched.length > 0) {
      await finish({
        status: "conflict",
        observed: remote,
        conflicts: mismatched,
      });
      return await done();
    }
    await finish({
      status: "synced",
      baseline: remote,
      observed: remote,
      conflicts: [],
      pushed: [...sync.dirtyFields],
      bindRemoteId: remote.remoteId,
    });
    return await done();
  }

  let remote: AshedOpponentSnapshot | null;
  try {
    remote = await findUniqueWeekRecord(context, weekStart);
  } catch (error) {
    return await fail(error);
  }

  if (!remote) {
    if (matchup.externalCompetitionId) {
      await finish({ status: "conflict", errorCode: "record_missing" });
      return await done();
    }
    if (sync.errorCode === "create_retry_ready" && body.reason !== "sync") {
      await finish({ status: "pending", errorCode: "create_retry_ready" });
      return await done();
    }
    const dirty = sync.dirtyFields;
    if (dirty.length === 0) {
      await finish({
        status: "synced",
        baseline: null,
        observed: null,
        conflicts: [],
      });
      return await done();
    }
    try {
      await assertSyncWriteGate({
        actor,
        weekStart,
        matchupId,
        matchupVersion: matchup.version,
        leaseToken,
        ashedAllianceId: link.ashedAllianceId,
      });
    } catch (error) {
      return await fail(error);
    }
    try {
      const createBody = buildAshedOpponentCreate(context.allianceId, weekStart, desired);
      await revalidateVsOpponentSyncContext(actor, context);
      const beforeCreate = await findUniqueWeekRecord(context, weekStart);
      if (beforeCreate) {
        await finish({ status: "conflict", observed: beforeCreate, conflicts: [...VS_OPPONENT_FIELDS] });
        return await done();
      }
      await assertSyncWriteGate({ actor, weekStart, matchupId, matchupVersion: matchup.version, leaseToken, ashedAllianceId: link.ashedAllianceId });
      const held = await writeSyncUnderLease({ matchupId, allianceId: actor.allianceId, leaseToken, patch: { status: "uncertain", errorCode: "create_inflight" }, release: false });
      if (!held) throw new VsPerformanceError("stale", 409);
      await createAshedOpponentMeta(context, createBody);
    } catch (error) {
      return await fail(error);
    }
    let readBack: AshedOpponentSnapshot | null;
    try {
      readBack = await findUniqueWeekRecord(context, weekStart);
    } catch {
      return await fail(new VsSyncError("uncertain"));
    }
    if (!readBack) {
      return await fail(new VsSyncError("uncertain"));
    }
    const mismatched = VS_OPPONENT_FIELDS.filter(
      (field) =>
        vsOpponentFieldValue(readBack!, field) !==
        vsOpponentFieldValue(desired, field),
    );
    if (mismatched.length > 0 || readBack.compatibilityScore !== "0") {
      await finish({
        status: "conflict",
        observed: readBack,
        conflicts: mismatched,
      });
      return await done();
    }
    await finish({
      status: "synced",
      baseline: readBack,
      observed: readBack,
      conflicts: [],
      pushed: [...VS_OPPONENT_FIELDS],
      bindRemoteId: readBack.remoteId,
    });
    await writeTrainsOfficerAudit({
      sessionId: actor.sessionId,
      allianceId: actor.allianceId,
      hqUserId: actor.hqUserId ?? undefined,
      action: "vs.matchup_sync",
      severity: "update",
      resourceType: "vs_matchup",
      resourceId: `${actor.allianceId}:${weekStart}`,
      metadata: { weekStart, status: "synced", created: true },
    });
    return await done();
  }

  if (
    matchup.externalCompetitionId &&
    remote.remoteId !== matchup.externalCompetitionId
  ) {
    await finish({
      status: "conflict",
      errorCode: "record_missing",
      observed: remote,
      conflicts: [...VS_OPPONENT_FIELDS],
    });
    return await done();
  }

  const dirty = sync.dirtyFields;
  let update: ReturnType<typeof buildAshedOpponentUpdate>;
  try {
    update = buildAshedOpponentUpdate({
      current: remote,
      baseline: sync.baselineSnapshot,
      desired,
      dirtyFields: dirty,
    });
  } catch (error) {
    return await fail(error);
  }
  if (update.conflicts.length > 0) {
    await finish({
      status: "conflict",
      observed: remote,
      conflicts: update.conflicts,
    });
    return await done();
  }
  if (Object.keys(update.patch).length > 0) {
    try {
      await revalidateVsOpponentSyncContext(actor, context);
      const beforeWrite = await findUniqueWeekRecord(context, weekStart);
      if (!beforeWrite || beforeWrite.remoteId !== remote.remoteId) {
        await finish({ status: "conflict", errorCode: "record_missing", ...(beforeWrite ? { observed: beforeWrite, conflicts: [...VS_OPPONENT_FIELDS] } : {}) });
        return await done();
      }
      remote = beforeWrite;
      update = buildAshedOpponentUpdate({ current: remote, baseline: sync.baselineSnapshot, desired, dirtyFields: dirty });
      if (update.conflicts.length) {
        await finish({ status: "conflict", observed: remote, conflicts: update.conflicts });
        return await done();
      }
      await assertSyncWriteGate({ actor, weekStart, matchupId, matchupVersion: matchup.version, leaseToken, ashedAllianceId: link.ashedAllianceId });
      if (Object.keys(update.patch).length) await updateAshedOpponentMeta(context, remote.remoteId, update.patch);
    } catch (error) {
      return await fail(error);
    }
  }
  let readBack: AshedOpponentSnapshot | null;
  try {
    readBack = await findUniqueWeekRecord(context, weekStart);
  } catch {
    return await fail(new VsSyncError("uncertain"));
  }
  if (!readBack || readBack.remoteId !== remote.remoteId) {
    return await fail(new VsSyncError("uncertain"));
  }
  const mismatched = dirty.filter(
    (field) =>
      vsOpponentFieldValue(readBack!, field) !==
      vsOpponentFieldValue(desired, field),
  );
  if (mismatched.length > 0) {
    await finish({
      status: "conflict",
      observed: readBack,
      conflicts: mismatched,
    });
    return await done();
  }
  await finish({
    status: "synced",
    baseline: readBack,
    observed: readBack,
    conflicts: [],
    pushed: [...dirty],
  });
  await writeTrainsOfficerAudit({
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.matchup_sync",
    severity: "update",
    resourceType: "vs_matchup",
    resourceId: `${actor.allianceId}:${weekStart}`,
    metadata: { weekStart, status: "synced", pushed: [...dirty] },
  });
  return await done();
  } finally {
    await releaseSyncLease(matchupId, actor.allianceId, leaseToken);
  }
}

async function applyObservedAshedValues(input: {
  actor: VsActor;
  weekStart: string;
  scope: string;
  remote: AshedOpponentSnapshot;
  conflictFields: readonly VsOpponentField[];
  conflictToken: string;
  leaseToken: string;
  matchupId: string;
}): Promise<boolean> {
  const { actor, weekStart, remote } = input;
  await assertVsActorCurrent(actor);
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    await assertVsActorContextTx(tx, actor);
    await assertVsAshedLinkTx(tx, actor.allianceId, remote.allianceId);
    const matchup = await loadVsMatchupRowForUpdate(
      tx,
      actor.allianceId,
      weekStart,
    );
    if (!matchup || matchup.id !== input.matchupId) {
      throw new VsPerformanceError("stale", 409);
    }
    const sync = await ensureVsMatchupSyncRow(
      tx,
      input.matchupId,
      actor.allianceId,
    );
    if (
      sync.leaseToken !== input.leaseToken ||
      !sync.leaseExpiresAt ||
      sync.leaseExpiresAt <= new Date() ||
      sync.status !== "conflict" ||
      !sync.observedSnapshot ||
      sync.conflictFields.length === 0
    ) {
      return false;
    }
    const freshDays = await tx
      .select()
      .from(schema.vsMatchDayResults)
      .where(eq(schema.vsMatchDayResults.matchupId, matchup.id));
    const expectedToken = vsOpponentConflictToken({
      remote: sync.observedSnapshot,
      matchupVersion: matchup.version,
      days: freshDays.map((d) => [d.id, d.version] as const),
      fields: sync.conflictFields,
      scope: input.scope,
    });
    if (
      expectedToken !== input.conflictToken ||
      ashedOpponentSnapshotKey(sync.observedSnapshot) !==
        ashedOpponentSnapshotKey(remote)
    ) {
      throw new VsPerformanceError("stale", 409);
    }
    const dates = vsDatesForWeek(weekStart);
    const scores: (string | null)[] = [...matchup.opponentDailyScores];
    const accepted: VsOpponentField[] = [];
    const patch: Record<string, unknown> = {};
    let metaChanged = false;
    for (const field of input.conflictFields) {
      const match = dayFieldPattern.exec(field);
      if (match) {
        const index = Number(match[1]) - 1;
        const remoteScore = remote.opponentDailyScores[index];
        const head = await loadVsMatchDayResultForUpdate(
          tx,
          matchup.id,
          dates[index]!,
          actor.allianceId,
        );
        if (head && head.finality === "final" && head.hqConfirmed === 1 && head.ourScore != null && head.opponentScore != null) {
          if (remoteScore == null) throw new VsPerformanceError("confirmed_day", 409);
          const normalized = normalizeVsResult({
            totals: {
              ourScore: String(head.ourScore),
              opponentScore: remoteScore,
            },
            reportedOutcome: null,
            finality: "final",
          });
          await saveVsMatchDayResultTx(tx, {
            actor,
            matchupId: matchup.id,
            recordedDate: head.recordedDate,
            expectedVersion: head.version,
            requestId: `sync-resolve:${nanoid(12)}`,
            scope: input.scope,
            normalized,
            hqConfirmed: true,
            evidence: {
              kind: "hq_manual",
              sourceRef: remote.remoteId,
              sourceRevision: remote.sourceRevision,
            },
          });
          scores[index] = remoteScore;
          accepted.push(field);
        } else {
          scores[index] = remoteScore;
          accepted.push(field);
        }
        continue;
      }
      patch[field] = vsOpponentFieldValue(remote, field);
      metaChanged = true;
      accepted.push(field);
    }
    if (metaChanged || accepted.some((f) => f.startsWith("day:")) || matchup.externalCompetitionId !== remote.remoteId) {
      await tx
        .update(schema.vsMatchups)
        .set({
          ...(patch.opponentServer !== undefined
            ? { opponentServer: patch.opponentServer as number | null }
            : {}),
          ...(patch.opponentName !== undefined
            ? { opponentName: patch.opponentName as string | null }
            : {}),
          ...(patch.opponentTag !== undefined
            ? { opponentTag: patch.opponentTag as string | null }
            : {}),
          ...(patch.weekOutcome !== undefined
            ? {
                weekOutcome:
                  patch.weekOutcome as (typeof schema.vsMatchups.$inferSelect)["weekOutcome"],
              }
            : {}),
          opponentDailyScores: scores as VsOpponentInfo["opponentDailyScores"],
          externalCompetitionId: remote.remoteId,
          version: matchup.version + 1,
          updatedByHqUserId: actor.hqUserId,
          updatedAt: new Date(),
        })
        .where(eq(schema.vsMatchups.id, matchup.id));
    }
    const remainingDirty = sync.dirtyFields.filter(
      (field) => !accepted.includes(field),
    );
    await tx
      .update(schema.vsMatchupAshedSync)
      .set({
        baselineSnapshot: remote,
        observedSnapshot: remote,
        conflictFields: [],
        dirtyFields: remainingDirty,
        status: remainingDirty.length > 0 ? "pending" : "synced",
        errorCode: null,
        processedVersion: remainingDirty.length === 0 ? matchup.version + 1 : sync.processedVersion,
        leaseToken: null,
        leaseExpiresAt: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.vsMatchupAshedSync.matchupId, input.matchupId),
          eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
        ),
      );
    return true;
  });
}

export async function attemptVsOpponentSync(
  actor: VsActor,
  weekStart: string,
): Promise<VsMatchupSyncStatus | null> {
  try {
    const eligible = await vsAshedSyncEligibility(actor);
    if (!eligible) {
      const matchupId = await matchupIdForWeek(actor.allianceId, weekStart);
      if (matchupId) {
        const link = await loadVsAllianceLink(actor.allianceId);
        if (link) {
          const db = getDb();
          await db.transaction(async (tx) => {
            const sync = await ensureVsMatchupSyncRow(
              tx,
              matchupId,
              actor.allianceId,
            );
            if (sync.status === "conflict" || sync.status === "uncertain") {
              return;
            }
            if (
              sync.leaseExpiresAt &&
              sync.leaseExpiresAt > new Date()
            ) {
              return;
            }
            await tx
              .update(schema.vsMatchupAshedSync)
              .set({
                status: "credentials_required",
                errorCode: sync.errorCode === "create_retry_ready" ? sync.errorCode : "credentials_required",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.vsMatchupAshedSync.matchupId, matchupId),
                  eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
                ),
              );
          });
        }
      }
      return "credentials_required";
    }
    const scope = vsScope(actor, weekStart);
    await syncAshedOpponentInfo(actor, {
      weekStart,
      scope,
      reason: "auto",
    }, false);
  } catch {
  }
  const matchupId = await matchupIdForWeek(actor.allianceId, weekStart);
  if (!matchupId) return null;
  const [row] = await getDb()
    .select({ status: schema.vsMatchupAshedSync.status })
    .from(schema.vsMatchupAshedSync)
    .where(
      and(
        eq(schema.vsMatchupAshedSync.matchupId, matchupId),
        eq(schema.vsMatchupAshedSync.allianceId, actor.allianceId),
      ),
    )
    .limit(1);
  return row?.status ?? null;
}

export async function listPreviousVsOpponents(
  actor: VsActor,
): Promise<
  Array<{ server: number | null; tag: string | null; name: string | null }>
> {
  const local = await getDb()
    .select({
      opponentServer: schema.vsMatchups.opponentServer,
      opponentTag: schema.vsMatchups.opponentTag,
      opponentName: schema.vsMatchups.opponentName,
      weekStart: schema.vsMatchups.weekStart,
    })
    .from(schema.vsMatchups)
    .where(
      and(
        eq(schema.vsMatchups.allianceId, actor.allianceId),
        or(
          isNotNull(schema.vsMatchups.opponentName),
          isNotNull(schema.vsMatchups.opponentTag),
          isNotNull(schema.vsMatchups.opponentServer),
        ),
      ),
    )
    .orderBy(desc(schema.vsMatchups.weekStart))
    .limit(40);
  const seen = new Set<string>();
  const out: Array<{
    server: number | null;
    tag: string | null;
    name: string | null;
  }> = [];
  const push = (entry: {
    server: number | null;
    tag: string | null;
    name: string | null;
  }) => {
    if (!entry.server && !entry.tag && !entry.name) return;
    const key = JSON.stringify([entry.server, entry.tag, entry.name]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  for (const row of local) {
    push({
      server: row.opponentServer,
      tag: row.opponentTag,
      name: row.opponentName,
    });
  }
  const link = await loadVsAllianceLink(actor.allianceId);
  if (link) {
    try {
      const resolved = await resolveVsOpponentSyncContext(actor);
      if (resolved) {
        const rows = await fetchAshedOpponentMeta(resolved);
        for (const row of rows) {
          push({
            server: row.opponentServer,
            tag: row.opponentTag,
            name: row.opponentName,
          });
        }
      }
    } catch {
    }
  }
  return out;
}

export function vsSyncAuditMetadata(
  actor: VsActor,
  weekStart: string,
  status: string,
) {
  return {
    sessionId: actor.sessionId,
    allianceId: actor.allianceId,
    hqUserId: actor.hqUserId ?? undefined,
    action: "vs.matchup_sync",
    severity: "update" as const,
    resourceType: "vs_matchup",
    resourceId: `${actor.allianceId}:${weekStart}`,
    metadata: { weekStart, status },
  };
}
