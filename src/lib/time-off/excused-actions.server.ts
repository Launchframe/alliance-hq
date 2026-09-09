import "server-only";

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { TimeOffError } from "./workflow.shared";
import { appendTimeOffRevision, type TimeOffActor } from "./mutations.server";
import { requestExcusedSync, retireRemoteRecord, updateEntrySyncStatus } from "./excused-outbox.server";
import { acquireExcusedLease, releaseExcusedLease, withExcusedLease } from "./excused-worker.server";
import { fetchExcusedRecord, fetchExcusedSnapshot, resolveExcusedConnection } from "./excused-transport.server";
import { ExcusedSyncError, ownsPrivateTimeOffNotes, sameExcusedContent, type ExcusedRecord } from "./excused-sync.shared";

export function excusedFingerprint(record: ExcusedRecord | null): string | null {
  return record ? createHash("sha256").update(JSON.stringify([record.id, record.allianceId, record.memberId, record.recordType, record.startDate, record.endDate, record.reason ?? "", record.changedAt])).digest("hex") : null;
}

function requireOfficer(actor: TimeOffActor) {
  if (!actor.hqUserId || !actor.canManageOthers) throw new TimeOffError("officerOnly", 403);
}

export async function isAshedTimeOffSyncEnabled(allianceId: string) {
  const [row] = await getDb().select({ mode: schema.alliances.operatingMode, externalId: schema.alliances.ashedAllianceId }).from(schema.alliances).where(eq(schema.alliances.id, allianceId)).limit(1);
  return !!row && row.mode === "ashed" && !!row.externalId;
}

export async function queueAllianceExcusedRefresh(actor: TimeOffActor) {
  requireOfficer(actor);
  if (!(await isAshedTimeOffSyncEnabled(actor.allianceId))) throw new ExcusedSyncError("conflict");
  await getDb().transaction(async (tx) => {
    await requestExcusedSync(tx, actor.allianceId);
    await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId: actor.allianceId, hqUserId: actor.hqUserId, action: "time_off.sync_refresh", resourceType: "alliance", resourceId: actor.allianceId });
  });
}

export async function loadExcusedReview(actor: TimeOffActor, entryId: string) {
  requireOfficer(actor);
  const db = getDb();
  const [entry] = await db.select().from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.id, entryId), eq(schema.memberTimeOff.allianceId, actor.allianceId))).limit(1);
  if (!entry) throw new TimeOffError("entryUnavailable", 404);
  const [bindings, states, jobs] = await Promise.all([
    db.select().from(schema.timeOffSyncBindings).where(and(eq(schema.timeOffSyncBindings.entryId, entryId), eq(schema.timeOffSyncBindings.allianceId, actor.allianceId))).orderBy(asc(schema.timeOffSyncBindings.recordType)),
    db.select().from(schema.timeOffSyncState).where(eq(schema.timeOffSyncState.allianceId, actor.allianceId)).limit(1),
    db.select().from(schema.timeOffSyncJobs).where(eq(schema.timeOffSyncJobs.allianceId, actor.allianceId)).orderBy(asc(schema.timeOffSyncJobs.entryVersion)),
  ]);
  const state = states[0];
  const period = (record: ExcusedRecord) => ({ startDate: record.startDate, endDate: record.endDate, recordType: record.recordType });
  return { version: entry.version, bindings: bindings.map((binding) => {
    const job = jobs.filter((job) => job.bindingId === binding.id).at(-1);
    const remoteId = binding.remoteId ?? job?.createdRemoteId;
    const cached = state?.snapshot.find((record) => record.id === remoteId);
    const newerBaseline = binding.remoteSnapshot && binding.lastSyncedAt && (!state?.lastSyncedAt || binding.lastSyncedAt > state.lastSyncedAt) ? binding.remoteSnapshot : null;
    const candidateRemote = newerBaseline ?? cached ?? null;
    const remote = candidateRemote?.memberId === entry.ashedMemberId && candidateRemote.recordType === binding.recordType ? candidateRemote : null;
    const candidates = (state?.snapshot ?? []).filter((record) => record.memberId === entry.ashedMemberId && record.recordType === binding.recordType && job?.desired && sameExcusedContent(record, job.desired));
    return {
      id: binding.id, recordType: binding.recordType, status: binding.status,
      fingerprint: excusedFingerprint(remote), remote: remote ? period(remote) : null,
      candidates: candidates.map((record) => ({ ...period(record), id: record.id, createdAt: record.changedAt, fingerprint: excusedFingerprint(record)! })),
    };
  }) };
}

export async function applyExcusedAction(actor: TimeOffActor, entryId: string, body: unknown) {
  requireOfficer(actor);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TimeOffError("staleEntry", 409);
  const input = body as Record<string, unknown>;
  const action = input.action;
  if (!["retry", "keep_hq", "use_ashed", "link_existing"].includes(String(action))) throw new TimeOffError("forbidden", 403);
  const review = await loadExcusedReview(actor, entryId);
  if (!(await isAshedTimeOffSyncEnabled(actor.allianceId))) throw new ExcusedSyncError("conflict");
  if (input.version !== review.version) throw new TimeOffError("staleEntry", 409);
  if (action === "retry") {
    await getDb().transaction(async (tx) => {
      const [entry] = await tx.select().from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.id, entryId), eq(schema.memberTimeOff.allianceId, actor.allianceId))).limit(1).for("update");
      if (!entry || entry.version !== input.version) throw new TimeOffError("staleEntry", 409);
      const bindings = await tx.select().from(schema.timeOffSyncBindings).where(eq(schema.timeOffSyncBindings.entryId, entryId));
      for (const binding of bindings) {
        if (binding.status === "uncertain" || binding.status === "conflict") continue;
        await tx.update(schema.timeOffSyncBindings).set({ status: "pending" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await tx.update(schema.timeOffSyncJobs).set({ state: "pending" }).where(and(eq(schema.timeOffSyncJobs.bindingId, binding.id), eq(schema.timeOffSyncJobs.state, "blocked")));
      }
      await requestExcusedSync(tx, actor.allianceId);
      await updateEntrySyncStatus(tx, entryId);
      await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId: actor.allianceId, hqUserId: actor.hqUserId, action: "time_off.sync_retry", resourceType: "member_time_off", resourceId: entryId });
    });
    return;
  }
  const reviewed = review.bindings.find((binding) => binding.id === input.bindingId);
  if (!reviewed || input.fingerprint !== reviewed.fingerprint) throw new TimeOffError("staleEntry", 409);
  const lease = await acquireExcusedLease(actor.allianceId, true);
  if (!lease) throw new ExcusedSyncError("busy");
  try {
    const context = await resolveExcusedConnection(actor.allianceId);
    if (!context) throw new ExcusedSyncError("credentials_required");
    const db = getDb();
    const [entry] = await db.select().from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.id, entryId), eq(schema.memberTimeOff.allianceId, actor.allianceId))).limit(1);
    const [binding] = await db.select().from(schema.timeOffSyncBindings).where(and(eq(schema.timeOffSyncBindings.id, reviewed.id), eq(schema.timeOffSyncBindings.entryId, entryId))).limit(1);
    if (!entry || !binding || entry.version !== input.version) throw new TimeOffError("staleEntry", 409);
    if (binding.appId && binding.appId !== context.appId || binding.upstreamAllianceId && binding.upstreamAllianceId !== context.allianceId) throw new ExcusedSyncError("conflict");
    const [job] = await db.select().from(schema.timeOffSyncJobs).where(eq(schema.timeOffSyncJobs.bindingId, binding.id)).orderBy(desc(schema.timeOffSyncJobs.entryVersion)).limit(1);
    const snapshot = await fetchExcusedSnapshot(context);
    const remoteId = binding.remoteId ?? job?.createdRemoteId;
    const remote = remoteId ? await fetchExcusedRecord(context, remoteId, entry.ashedMemberId) : null;
    if (excusedFingerprint(remote) !== input.fingerprint) throw new TimeOffError("staleEntry", 409);
    let selected = remote;
    if (action === "link_existing") {
      const candidate = reviewed.candidates.find((record) => record.id === input.remoteId);
      if (!candidate || candidate.fingerprint !== input.candidateFingerprint) throw new TimeOffError("staleEntry", 409);
      selected = await fetchExcusedRecord(context, candidate.id, entry.ashedMemberId);
      if (!selected || excusedFingerprint(selected) !== input.candidateFingerprint || selected.recordType !== binding.recordType) throw new TimeOffError("staleEntry", 409);
    }
    if (actor.refresh) {
      const current = await actor.refresh();
      if (current.allianceId !== actor.allianceId || current.hqUserId !== actor.hqUserId) throw new TimeOffError("forbidden", 403);
      requireOfficer(current);
    }
    await withExcusedLease(actor.allianceId, lease.token, async (tx) => {
      const [current] = await tx.select().from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, entryId)).limit(1).for("update");
      if (!current || current.version !== input.version) throw new TimeOffError("staleEntry", 409);
      const allBindings = await tx.select().from(schema.timeOffSyncBindings).where(eq(schema.timeOffSyncBindings.entryId, entryId));
      if (action === "use_ashed" && allBindings.some((row) => row.status === "uncertain")) throw new ExcusedSyncError("uncertain");
      if (!remote && binding.remoteId) await retireRemoteRecord(tx, binding, context.appId);
      if (action === "use_ashed") {
        const now = new Date();
        await tx.update(schema.timeOffSyncJobs).set({ state: "superseded" }).where(eq(schema.timeOffSyncJobs.bindingId, binding.id));
        if (selected) {
          const [imported] = await tx.insert(schema.memberTimeOff).values({
            id: nanoid(), allianceId: actor.allianceId, ashedMemberId: current.ashedMemberId, memberName: current.memberName,
            startDate: selected.startDate, endDate: selected.endDate, notes: ownsPrivateTimeOffNotes(current) ? current.notes : selected.reason,
            privateNotesOwned: ownsPrivateTimeOffNotes(current), availability: "full_away", entryKind: "officer_marked", source: "ashed",
            activityScope: selected.recordType, globalAbsence: false, noticeVerified: selected.changedAt != null,
            version: 1, syncStatus: "synced", lastSyncedAt: now, createdAt: now, updatedAt: now,
          }).returning();
          await tx.update(schema.timeOffSyncBindings).set({ entryId: imported!.id, origin: "ashed", remoteId: selected.id, remoteSnapshot: selected, status: "synced", appId: context.appId, upstreamAllianceId: context.allianceId, lastSyncedAt: now }).where(eq(schema.timeOffSyncBindings.id, binding.id));
          const proof = !current.cancelledAt && current.entryKind !== "unexpected" && selected.changedAt ? new Date(selected.changedAt) : now;
          await appendTimeOffRevision(tx, actor, imported!, { enqueue: false, recordedAt: proof });
        } else {
          await tx.update(schema.timeOffSyncBindings).set({ status: "retired" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        }
        const remaining = allBindings.filter((row) => row.id !== binding.id && row.status !== "retired" && (current.activityScope === "all" || current.activityScope === row.recordType));
        const [next] = await tx.update(schema.memberTimeOff).set({
          version: current.version + 1, updatedAt: now, globalAbsence: false,
          activityScope: remaining[0]?.recordType ?? current.activityScope,
          cancelledAt: current.cancelledAt ?? (remaining.length ? null : now),
        }).where(eq(schema.memberTimeOff.id, entryId)).returning();
        await appendTimeOffRevision(tx, actor, next!, { enqueue: false });
        for (const other of remaining) {
          const [pending] = await tx.select().from(schema.timeOffSyncJobs).where(and(eq(schema.timeOffSyncJobs.bindingId, other.id), inArray(schema.timeOffSyncJobs.state, ["pending", "creating", "deleting", "blocked", "uncertain", "conflict"]))).orderBy(desc(schema.timeOffSyncJobs.entryVersion)).limit(1);
          if (pending) await tx.insert(schema.timeOffSyncJobs).values({ id: nanoid(), allianceId: actor.allianceId, bindingId: other.id, entryVersion: next!.version, desired: pending.desired }).onConflictDoNothing();
        }
        await requestExcusedSync(tx, actor.allianceId);
        await updateEntrySyncStatus(tx, entryId);
      } else {
        await tx.update(schema.timeOffSyncBindings).set({ remoteId: selected?.id ?? null, remoteSnapshot: selected, origin: "hq", appId: context.appId, upstreamAllianceId: context.allianceId, status: "pending" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await tx.update(schema.timeOffSyncJobs).set({ state: "superseded" }).where(and(eq(schema.timeOffSyncJobs.bindingId, binding.id), inArray(schema.timeOffSyncJobs.state, ["uncertain", "conflict", "blocked"])));
        const [next] = await tx.update(schema.memberTimeOff).set({ version: current.version + 1, updatedAt: new Date() }).where(eq(schema.memberTimeOff.id, entryId)).returning();
        await appendTimeOffRevision(tx, actor, next!);
      }
      await tx.update(schema.timeOffSyncState).set({ snapshot, lastSyncedAt: new Date() }).where(eq(schema.timeOffSyncState.allianceId, actor.allianceId));
      await tx.insert(schema.auditLog).values({ id: nanoid(), allianceId: actor.allianceId, hqUserId: actor.hqUserId, action: `time_off.sync_${action}`, resourceType: "member_time_off", resourceId: entryId, metadata: { bindingId: binding.id } });
    });
  } finally {
    await releaseExcusedLease(actor.allianceId, lease.token, { nextPollAt: new Date() });
  }
}
