import "server-only";

import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { ExcusedSyncError, groupExcusedRecords, ownsPrivateTimeOffNotes, sameExcusedContent, type ExcusedRecord } from "./excused-sync.shared";
import { updateEntrySyncStatus, type SyncEntry, type SyncTransaction } from "./excused-outbox.server";

async function importRevision(tx: SyncTransaction, entry: SyncEntry, recordedAt: Date) {
  await tx.insert(schema.memberTimeOffRevisions).values({
    id: nanoid(), entryId: entry.id, allianceId: entry.allianceId, version: entry.version,
    snapshot: {
      startDate: entry.startDate, endDate: entry.endDate,
      entryKind: "officer_marked", globalAbsence: entry.globalAbsence,
      activityScope: entry.activityScope === "vs" || entry.activityScope === "donation" ? entry.activityScope : "all",
      cancelled: entry.cancelledAt != null,
    }, recordedAt, observedAt: new Date(),
  });
}

export async function reconcileImportedExcuses(input: {
  allianceId: string;
  appId: string;
  snapshot: ExcusedRecord[];
  confirmedMissingIds: Set<string>;
  leaseToken: string;
}, transaction?: SyncTransaction) {
  const reconcile = async (tx: SyncTransaction) => {
    const entries = await tx.select().from(schema.memberTimeOff).where(eq(schema.memberTimeOff.allianceId, input.allianceId))
      .orderBy(asc(schema.memberTimeOff.id)).for("update");
    const bindings = await tx.select().from(schema.timeOffSyncBindings).where(eq(schema.timeOffSyncBindings.allianceId, input.allianceId))
      .orderBy(asc(schema.timeOffSyncBindings.id)).for("update");
    const jobs = await tx.select().from(schema.timeOffSyncJobs).where(and(eq(schema.timeOffSyncJobs.allianceId, input.allianceId), inArray(schema.timeOffSyncJobs.state, ["pending", "creating", "deleting", "uncertain", "blocked", "conflict"])));
    const roster = await tx.select({ id: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
      .from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, input.allianceId));
    const tombstones = await tx.select({ id: schema.timeOffSyncTombstones.remoteId }).from(schema.timeOffSyncTombstones)
      .where(and(eq(schema.timeOffSyncTombstones.allianceId, input.allianceId), eq(schema.timeOffSyncTombstones.appId, input.appId)));
    const retired = new Set(tombstones.map((row) => row.id));
    const byRemote = new Map(bindings.filter((binding) => binding.remoteId).map((binding) => [binding.remoteId!, binding]));
    const byEntry = new Map(entries.map((entry) => [entry.id, entry]));
    const names = new Map(roster.map((member) => [member.id, member.name]));
    const remoteById = new Map(input.snapshot.map((record) => [record.id, record]));
    const now = new Date();
    const invalidBindings = new Set<string>();
    for (const binding of bindings) {
      const remote = binding.remoteId ? remoteById.get(binding.remoteId) : undefined;
      if (binding.appId && binding.appId !== input.appId || remote && (remote.memberId !== byEntry.get(binding.entryId)?.ashedMemberId || remote.recordType !== binding.recordType)) {
        invalidBindings.add(binding.id);
        await tx.update(schema.timeOffSyncBindings).set({ status: "conflict" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await updateEntrySyncStatus(tx, binding.entryId);
      }
    }

    for (const binding of bindings.filter((binding) => binding.origin === "hq")) {
      if (!binding.remoteId || invalidBindings.has(binding.id) || jobs.some((job) => job.bindingId === binding.id)) continue;
      const remote = remoteById.get(binding.remoteId);
      if (binding.appId && binding.appId !== input.appId || remote && binding.remoteSnapshot && !sameExcusedContent(remote, binding.remoteSnapshot) || !remote && input.confirmedMissingIds.has(binding.remoteId)) {
        await tx.update(schema.timeOffSyncBindings).set({ status: "conflict" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await updateEntrySyncStatus(tx, binding.entryId);
      } else if (remote && binding.remoteSnapshot && sameExcusedContent(remote, binding.remoteSnapshot)) {
        await tx.update(schema.timeOffSyncBindings).set({ remoteSnapshot: remote, status: "synced", lastSyncedAt: now }).where(eq(schema.timeOffSyncBindings.id, binding.id));
        await updateEntrySyncStatus(tx, binding.entryId);
      }
    }

    const importable = input.snapshot.filter((record) => {
      if (retired.has(record.id) || !names.has(record.memberId)) return false;
      const mapped = byRemote.get(record.id);
      if (mapped) return !invalidBindings.has(mapped.id) && mapped.origin === "ashed" && (!mapped.appId || mapped.appId === input.appId) && !byEntry.get(mapped.entryId)?.cancelledAt;
      return !jobs.some((job) => job.desired && (job.createdRemoteId === record.id ||
        job.desired.memberId === record.memberId && job.desired.recordType === record.recordType &&
        job.desired.startDate === record.startDate && job.desired.endDate === record.endDate &&
        (sameExcusedContent(job.desired, record) || job.state === "creating" || job.state === "uncertain")));
    });
    const groups = groupExcusedRecords(importable).flatMap((group) => {
      const noteKeys = new Set(group.records.map((record) => {
        const entry = byEntry.get(byRemote.get(record.id)?.entryId ?? "");
        return entry && ownsPrivateTimeOffNotes(entry) ? JSON.stringify([true, entry.notes]) : "ashed";
      }));
      return noteKeys.size > 1 ? group.records.map((record) => ({ scope: record.recordType, records: [record] })) : [group];
    });
    const usedEntries = new Set<string>();
    let changed = 0;
    for (const group of groups) {
      const mapped = group.records.map((record) => byRemote.get(record.id));
      const existingId = mapped[0]?.entryId;
      const originalBindings = bindings.filter((binding) => binding.entryId === existingId && binding.origin === "ashed" && binding.remoteId && binding.status !== "retired");
      const reusable = existingId && mapped.every((binding) => binding?.entryId === existingId) && originalBindings.length === group.records.length;
      const existing = reusable ? byEntry.get(existingId) : undefined;
      const first = group.records[0];
      const inheritedNotes = byEntry.get(mapped[0]?.entryId ?? "");
      const noticeVerified = group.records.every((record) => record.changedAt != null);
      const values = {
        allianceId: input.allianceId, ashedMemberId: first.memberId, memberName: names.get(first.memberId)!,
        startDate: first.startDate, endDate: first.endDate,
        notes: inheritedNotes && ownsPrivateTimeOffNotes(inheritedNotes) ? inheritedNotes.notes : first.reason,
        privateNotesOwned: inheritedNotes ? ownsPrivateTimeOffNotes(inheritedNotes) : false,
        availability: "full_away", entryKind: "officer_marked", source: "ashed",
        activityScope: group.scope, globalAbsence: group.scope === "all", noticeVerified,
        syncStatus: "synced", lastSyncedAt: now,
      };
      const differs = !existing || existing.startDate !== values.startDate || existing.endDate !== values.endDate || existing.notes !== values.notes || existing.activityScope !== group.scope || existing.globalAbsence !== values.globalAbsence || existing.noticeVerified !== noticeVerified;
      let entry: SyncEntry;
      if (existing) {
        [entry] = await tx.update(schema.memberTimeOff).set({ ...values, ...(differs ? { version: existing.version + 1, updatedAt: now } : {}) })
          .where(eq(schema.memberTimeOff.id, existing.id)).returning();
      } else {
        [entry] = await tx.insert(schema.memberTimeOff).values({ ...values, id: nanoid(), version: 1, createdAt: now, updatedAt: now }).returning();
      }
      usedEntries.add(entry!.id);
      if (differs) {
        const timestamps = group.records.map((record) => Date.parse(record.changedAt ?? ""));
        await importRevision(tx, entry!, noticeVerified ? new Date(Math.max(...timestamps)) : now);
        changed++;
      }
      for (const record of group.records) {
        const binding = byRemote.get(record.id);
        const next = { entryId: entry!.id, origin: "ashed" as const, appId: input.appId, upstreamAllianceId: record.allianceId, remoteSnapshot: record, status: "synced", lastSyncedAt: now };
        if (binding) await tx.update(schema.timeOffSyncBindings).set(next).where(eq(schema.timeOffSyncBindings.id, binding.id));
        else await tx.insert(schema.timeOffSyncBindings).values({ ...next, id: nanoid(), allianceId: input.allianceId, recordType: record.recordType, remoteId: record.id });
      }
    }
    for (const binding of bindings.filter((binding) => binding.origin === "ashed" && binding.remoteId && input.confirmedMissingIds.has(binding.remoteId))) {
      await tx.insert(schema.timeOffSyncTombstones).values({ id: nanoid(), allianceId: input.allianceId, appId: input.appId, remoteId: binding.remoteId! }).onConflictDoNothing();
      await tx.update(schema.timeOffSyncBindings).set({ status: "retired" }).where(eq(schema.timeOffSyncBindings.id, binding.id));
    }
    for (const entry of entries) {
      if (entry.cancelledAt || usedEntries.has(entry.id) || !bindings.some((binding) => binding.entryId === entry.id && binding.origin === "ashed")) continue;
      const remaining = await tx.select({ status: schema.timeOffSyncBindings.status }).from(schema.timeOffSyncBindings)
        .where(and(eq(schema.timeOffSyncBindings.entryId, entry.id), isNotNull(schema.timeOffSyncBindings.remoteId)));
      if (remaining.some((binding) => binding.status !== "retired")) continue;
      const [cancelled] = await tx.update(schema.memberTimeOff).set({ cancelledAt: now, updatedAt: now, version: entry.version + 1, syncStatus: "synced", lastSyncedAt: now }).where(eq(schema.memberTimeOff.id, entry.id)).returning();
      await importRevision(tx, cancelled!, now);
      changed++;
    }
    const [held] = await tx.update(schema.timeOffSyncState).set({ leaseExpiresAt: new Date(Date.now() + 180_000) })
      .where(and(eq(schema.timeOffSyncState.allianceId, input.allianceId), eq(schema.timeOffSyncState.leaseToken, input.leaseToken), gt(schema.timeOffSyncState.leaseExpiresAt, new Date())))
      .returning({ id: schema.timeOffSyncState.allianceId });
    if (!held) throw new ExcusedSyncError("busy");
    return changed;
  };
  return transaction ? reconcile(transaction) : getDb().transaction(reconcile);
}
