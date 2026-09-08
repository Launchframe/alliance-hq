import "server-only";

import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { lockAllianceAvailability } from "./availability.server";
import { decideExcusedSync, ExcusedSyncError, sameExcusedContent, type ExcusedRecord } from "./excused-sync.shared";
import { createExcusedRecord, deleteExcusedRecord, fetchExcusedRecord, fetchExcusedSnapshot, resolveExcusedConnection, validateExcusedMember, type ExcusedConnection } from "./excused-transport.server";
import { reconcileImportedExcuses } from "./excused-import.server";
import { retireRemoteRecord, updateEntrySyncStatus, type SyncBinding, type SyncJob, type SyncTransaction } from "./excused-outbox.server";

const LEASE_MS = 180_000;

export async function acquireExcusedLease(allianceId: string, force = false) {
  const db = getDb();
  await db.insert(schema.timeOffSyncState).values({ allianceId, requestedSeq: 1, nextPollAt: new Date(0) }).onConflictDoNothing();
  const now = new Date();
  const token = nanoid();
  const [lease] = await db.update(schema.timeOffSyncState).set({ leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) })
    .where(and(
      eq(schema.timeOffSyncState.allianceId, allianceId),
      or(isNull(schema.timeOffSyncState.leaseToken), lt(schema.timeOffSyncState.leaseExpiresAt, now)),
      force ? undefined : or(lte(schema.timeOffSyncState.nextPollAt, now), sql`${schema.timeOffSyncState.requestedSeq} > ${schema.timeOffSyncState.processedSeq}`),
    )).returning();
  return lease ? { ...lease, token } : null;
}

export async function withExcusedLease<T>(allianceId: string, token: string, work: (tx: SyncTransaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, allianceId);
    const result = await work(tx);
    const [held] = await tx.update(schema.timeOffSyncState).set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(and(eq(schema.timeOffSyncState.allianceId, allianceId), eq(schema.timeOffSyncState.leaseToken, token), gt(schema.timeOffSyncState.leaseExpiresAt, new Date())))
      .returning({ id: schema.timeOffSyncState.allianceId });
    if (!held) throw new ExcusedSyncError("busy");
    return result;
  });
}

export async function releaseExcusedLease(allianceId: string, token: string, patch: Partial<typeof schema.timeOffSyncState.$inferInsert> = {}) {
  await getDb().update(schema.timeOffSyncState).set({ ...patch, leaseToken: null, leaseExpiresAt: null })
    .where(and(eq(schema.timeOffSyncState.allianceId, allianceId), eq(schema.timeOffSyncState.leaseToken, token)));
}

async function checkpoint(allianceId: string, token: string, job: SyncJob, binding: SyncBinding, state: string, bindingPatch: Partial<typeof schema.timeOffSyncBindings.$inferInsert> = {}) {
  await withExcusedLease(allianceId, token, async (tx) => {
    await tx.select({ id: schema.memberTimeOff.id }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, binding.entryId)).for("update");
    await tx.update(schema.timeOffSyncJobs).set({ state }).where(eq(schema.timeOffSyncJobs.id, job.id));
    if (Object.values(bindingPatch).some((value) => value !== undefined)) await tx.update(schema.timeOffSyncBindings).set(bindingPatch).where(eq(schema.timeOffSyncBindings.id, binding.id));
    await updateEntrySyncStatus(tx, binding.entryId);
  });
}

async function processJob(allianceId: string, token: string, context: ExcusedConnection, job: SyncJob, snapshot: ExcusedRecord[]) {
  const db = getDb();
  const [binding] = await db.select().from(schema.timeOffSyncBindings).where(and(eq(schema.timeOffSyncBindings.id, job.bindingId), eq(schema.timeOffSyncBindings.allianceId, allianceId))).limit(1);
  if (!binding) return;
  const [entry] = await db.select().from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.id, binding.entryId), eq(schema.memberTimeOff.allianceId, allianceId))).limit(1);
  if (!entry) return;
  if (binding.appId && binding.appId !== context.appId || binding.upstreamAllianceId && binding.upstreamAllianceId !== context.allianceId || job.desired && job.desired.allianceId !== context.allianceId) {
    await checkpoint(allianceId, token, job, binding, "conflict", { status: "conflict" });
    return;
  }
  if (job.state === "creating") {
    if (!job.createdRemoteId || !job.desired) {
      await checkpoint(allianceId, token, job, binding, "uncertain", { status: "uncertain" });
      return;
    }
    const created = await fetchExcusedRecord(context, job.createdRemoteId, entry.ashedMemberId);
    if (!created || !sameExcusedContent(created, job.desired) || binding.remoteId && binding.remoteId !== created.id) {
      await checkpoint(allianceId, token, job, binding, "uncertain", { status: "uncertain" });
      return;
    }
    await checkpoint(allianceId, token, job, binding, "done", { remoteId: created.id, remoteSnapshot: created, appId: context.appId, upstreamAllianceId: context.allianceId, status: "synced", lastSyncedAt: new Date() });
    return;
  }
  if (job.entryVersion !== entry.version && job.state !== "deleting") {
    await checkpoint(allianceId, token, job, binding, "superseded");
    return;
  }
  if (binding.status === "conflict" || binding.status === "uncertain") {
    await checkpoint(allianceId, token, job, binding, binding.status);
    return;
  }
  const remote = binding.remoteId ? await fetchExcusedRecord(context, binding.remoteId, entry.ashedMemberId) : null;
  const desired = job.state === "deleting" ? null : job.desired;
  const decision = decideExcusedSync({ desired, remoteId: binding.remoteId, remote, baseline: binding.remoteSnapshot, uncertain: false, candidates: snapshot });
  if (decision === "conflict" || decision === "uncertain") {
    await checkpoint(allianceId, token, job, binding, decision, { status: decision });
    return;
  }
  if (decision === "done") {
    await withExcusedLease(allianceId, token, async (tx) => {
      await tx.select({ id: schema.memberTimeOff.id }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, entry.id)).for("update");
      if (binding.remoteId && !remote) await retireRemoteRecord(tx, binding, context.appId);
      const resumeCreate = job.state === "deleting" && job.desired && job.entryVersion === entry.version;
      await tx.update(schema.timeOffSyncJobs).set({ state: resumeCreate ? "pending" : "done" }).where(eq(schema.timeOffSyncJobs.id, job.id));
      await tx.update(schema.timeOffSyncBindings).set({ status: resumeCreate ? "pending" : "synced", ...(remote ? { remoteSnapshot: remote } : {}), lastSyncedAt: new Date() }).where(eq(schema.timeOffSyncBindings.id, binding.id));
      await updateEntrySyncStatus(tx, entry.id);
    });
    return;
  }
  const creating = decision === "create";
  if (creating) {
    try { await validateExcusedMember(context, entry.ashedMemberId); }
    catch (error) {
      if (!(error instanceof ExcusedSyncError) || error.code !== "conflict") throw error;
      await checkpoint(allianceId, token, job, binding, "conflict", { status: "conflict" });
      return;
    }
  }
  const begin = await withExcusedLease(allianceId, token, async (tx) => {
    const [current] = await tx.select({ version: schema.memberTimeOff.version }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, entry.id)).limit(1).for("update");
    if (current?.version !== job.entryVersion && job.state !== "deleting") {
      await tx.update(schema.timeOffSyncJobs).set({ state: "superseded" }).where(eq(schema.timeOffSyncJobs.id, job.id));
      return false;
    }
    await tx.update(schema.timeOffSyncJobs).set({ state: creating ? "creating" : "deleting", attempts: sql`${schema.timeOffSyncJobs.attempts} + 1`, attemptedAt: new Date() }).where(eq(schema.timeOffSyncJobs.id, job.id));
    await tx.update(schema.timeOffSyncBindings).set({ appId: context.appId, upstreamAllianceId: context.allianceId, status: "pending" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
    return true;
  });
  if (!begin) return;
  let createdId: string | null = null;
  try {
    if (creating) {
      const id = await createExcusedRecord(context, job.desired!);
      createdId = id;
      await db.update(schema.timeOffSyncJobs).set({ createdRemoteId: id }).where(and(eq(schema.timeOffSyncJobs.id, job.id), isNull(schema.timeOffSyncJobs.createdRemoteId)));
      const created = await fetchExcusedRecord(context, id, entry.ashedMemberId);
      if (!created || !sameExcusedContent(created, job.desired!)) throw new ExcusedSyncError("uncertain");
      await checkpoint(allianceId, token, job, binding, "done", { remoteId: id, remoteSnapshot: created, appId: context.appId, upstreamAllianceId: context.allianceId, status: "synced", lastSyncedAt: new Date() });
    } else {
      await deleteExcusedRecord(context, binding.remoteId!);
      await withExcusedLease(allianceId, token, async (tx) => {
        await tx.select({ id: schema.memberTimeOff.id }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, entry.id)).for("update");
        await retireRemoteRecord(tx, binding, context.appId);
        await tx.update(schema.timeOffSyncJobs).set({ state: job.desired ? "pending" : "done" }).where(eq(schema.timeOffSyncJobs.id, job.id));
        if (!job.desired) await tx.update(schema.timeOffSyncBindings).set({ status: "synced", lastSyncedAt: new Date() }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await updateEntrySyncStatus(tx, entry.id);
      });
    }
  } catch (error) {
    const code = error instanceof ExcusedSyncError ? error.code : creating ? "uncertain" : "failed";
    if (createdId) {
      await db.update(schema.timeOffSyncJobs).set({ createdRemoteId: createdId }).where(and(eq(schema.timeOffSyncJobs.id, job.id), isNull(schema.timeOffSyncJobs.createdRemoteId)));
      await checkpoint(allianceId, token, job, binding, code === "conflict" || code === "uncertain" ? "uncertain" : "creating", { status: code === "conflict" || code === "uncertain" ? "uncertain" : code === "credentials_required" ? "credentials_required" : "pending" });
    } else {
      const uncertain = creating && code === "uncertain";
      await checkpoint(allianceId, token, job, binding, uncertain ? "uncertain" : creating ? "blocked" : "deleting", { status: uncertain ? "uncertain" : code === "credentials_required" ? "credentials_required" : "failed" });
    }
  }
}

export async function syncAllianceExcuses(allianceId: string, options: { maxJobs?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const lease = await acquireExcusedLease(allianceId);
  if (!lease) return { processed: 0, skipped: true };
  let errorCode: string | null = null;
  let processed = 0;
  try {
    const context = await resolveExcusedConnection(allianceId);
    if (!context) return { processed: 0, skipped: true };
    const snapshot = await fetchExcusedSnapshot(context, started + (options.budgetMs ?? 90_000) - 20_000);
    const bindings = await getDb().select().from(schema.timeOffSyncBindings).where(eq(schema.timeOffSyncBindings.allianceId, allianceId));
    const entries = await getDb().select({ id: schema.memberTimeOff.id, memberId: schema.memberTimeOff.ashedMemberId }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.allianceId, allianceId));
    const memberByEntry = new Map(entries.map((entry) => [entry.id, entry.memberId]));
    const seen = new Set(snapshot.map((record) => record.id));
    const missing = new Set<string>();
    for (const binding of bindings) {
      if (!binding.remoteId || seen.has(binding.remoteId) || binding.appId && binding.appId !== context.appId) continue;
      if (Date.now() - started > (options.budgetMs ?? 90_000)) throw new ExcusedSyncError("failed");
      const remote = await fetchExcusedRecord(context, binding.remoteId, memberByEntry.get(binding.entryId) ?? "");
      if (remote) { snapshot.push(remote); seen.add(remote.id); } else missing.add(binding.remoteId);
    }
    await withExcusedLease(allianceId, lease.token, async (tx) => {
      await tx.update(schema.timeOffSyncState).set({ snapshot, lastSyncedAt: new Date() }).where(eq(schema.timeOffSyncState.allianceId, allianceId));
    });
    await reconcileImportedExcuses({ allianceId, appId: context.appId, snapshot, confirmedMissingIds: missing, leaseToken: lease.token });
    const jobs = await getDb().select().from(schema.timeOffSyncJobs).where(and(eq(schema.timeOffSyncJobs.allianceId, allianceId), inArray(schema.timeOffSyncJobs.state, ["pending", "creating", "deleting", "blocked"])))
      .orderBy(asc(schema.timeOffSyncJobs.createdAt), asc(schema.timeOffSyncJobs.id)).limit(options.maxJobs ?? 4);
    for (const job of jobs) {
      if (Date.now() - started > (options.budgetMs ?? 90_000) - 20_000) break;
      await processJob(allianceId, lease.token, context, job, snapshot);
      processed++;
    }
    return { processed, skipped: false };
  } catch (error) {
    errorCode = error instanceof ExcusedSyncError ? error.code : "failed";
    if (errorCode !== "busy") await withExcusedLease(allianceId, lease.token, async (tx) => {
      await tx.select({ id: schema.memberTimeOff.id }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.allianceId, allianceId)).orderBy(asc(schema.memberTimeOff.id)).for("update");
      await tx.update(schema.timeOffSyncBindings).set({ status: sql`case when ${schema.timeOffSyncBindings.status} in ('uncertain', 'conflict', 'retired') then ${schema.timeOffSyncBindings.status} else ${errorCode === "credentials_required" ? "credentials_required" : "failed"} end` })
        .where(eq(schema.timeOffSyncBindings.allianceId, allianceId));
      const affected = await tx.select({ id: schema.memberTimeOff.id }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.allianceId, allianceId));
      for (const entry of affected) await updateEntrySyncStatus(tx, entry.id);
    });
    return { processed, error: errorCode };
  } finally {
    const pending = await getDb().select({ id: schema.timeOffSyncJobs.id }).from(schema.timeOffSyncJobs)
      .where(and(eq(schema.timeOffSyncJobs.allianceId, allianceId), inArray(schema.timeOffSyncJobs.state, ["pending", "creating", "deleting"]))).limit(1);
    await releaseExcusedLease(allianceId, lease.token, {
      processedSeq: lease.requestedSeq, nextPollAt: new Date(Date.now() + (errorCode ? 60_000 : pending.length ? 1000 : 300_000)),
      lastError: errorCode,
    });
  }
}

export async function runExcusedSyncTick() {
  const db = getDb();
  const alliances = await db.select({ id: schema.alliances.id }).from(schema.alliances)
    .where(and(eq(schema.alliances.operatingMode, "ashed"), sql`${schema.alliances.ashedAllianceId} is not null`));
  for (const alliance of alliances) await db.insert(schema.timeOffSyncState).values({ allianceId: alliance.id, requestedSeq: 1, nextPollAt: new Date(0) }).onConflictDoNothing();
  const [due] = await db.select({ id: schema.timeOffSyncState.allianceId }).from(schema.timeOffSyncState)
    .innerJoin(schema.alliances, eq(schema.alliances.id, schema.timeOffSyncState.allianceId))
    .where(and(eq(schema.alliances.operatingMode, "ashed"), sql`${schema.alliances.ashedAllianceId} is not null`, or(lte(schema.timeOffSyncState.nextPollAt, new Date()), sql`${schema.timeOffSyncState.requestedSeq} > ${schema.timeOffSyncState.processedSeq}`), or(isNull(schema.timeOffSyncState.leaseToken), lt(schema.timeOffSyncState.leaseExpiresAt, new Date()))))
    .orderBy(asc(schema.timeOffSyncState.nextPollAt)).limit(1);
  return due ? syncAllianceExcuses(due.id) : { processed: 0, skipped: true };
}
