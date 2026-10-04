import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";
import { desiredExcusedRecord, type TimeOffSyncStatus } from "./excused-sync.shared";

export type SyncTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type SyncEntry = typeof schema.memberTimeOff.$inferSelect;
export type SyncBinding = typeof schema.timeOffSyncBindings.$inferSelect;
export type SyncJob = typeof schema.timeOffSyncJobs.$inferSelect;

export async function requestExcusedSync(tx: SyncTransaction, allianceId: string) {
  await tx.insert(schema.timeOffSyncState).values({ allianceId, requestedSeq: 1, nextPollAt: new Date() })
    .onConflictDoUpdate({ target: schema.timeOffSyncState.allianceId, set: {
      requestedSeq: sql`${schema.timeOffSyncState.requestedSeq} + 1`, nextPollAt: new Date(),
    } });
}

export async function enqueueTimeOffSync(tx: SyncTransaction, entry: SyncEntry, locale = "en-US"): Promise<TimeOffSyncStatus> {
  const [alliance] = await tx.select({ mode: schema.alliances.operatingMode, externalId: schema.alliances.ashedAllianceId })
    .from(schema.alliances).where(eq(schema.alliances.id, entry.allianceId)).limit(1);
  if (!alliance || alliance.mode === "native" || !alliance.externalId) return "local";
  const reason = (locale.startsWith("pt") ? ptBR : enUS).timeOff.sync.upstreamReason;
  for (const recordType of ["vs", "donation"] as const) {
    const [binding] = await tx.insert(schema.timeOffSyncBindings).values({
      id: nanoid(), allianceId: entry.allianceId, entryId: entry.id, recordType, origin: "hq", upstreamAllianceId: alliance.externalId,
    }).onConflictDoUpdate({ target: [schema.timeOffSyncBindings.entryId, schema.timeOffSyncBindings.recordType], set: {
      origin: "hq",
      status: sql`case when ${schema.timeOffSyncBindings.status} in ('uncertain', 'conflict') then ${schema.timeOffSyncBindings.status} else 'pending' end`,
    } }).returning();
    await tx.insert(schema.timeOffSyncJobs).values({
      id: nanoid(), allianceId: entry.allianceId, bindingId: binding!.id, entryVersion: entry.version,
      desired: desiredExcusedRecord(entry, alliance.externalId, recordType, reason),
    }).onConflictDoNothing();
  }
  await requestExcusedSync(tx, entry.allianceId);
  return updateEntrySyncStatus(tx, entry.id);
}

export async function updateEntrySyncStatus(tx: SyncTransaction, entryId: string): Promise<TimeOffSyncStatus> {
  const [entry] = await tx.select({ cancelledAt: schema.memberTimeOff.cancelledAt }).from(schema.memberTimeOff).where(eq(schema.memberTimeOff.id, entryId)).limit(1);
  const bindings = await tx.select({ status: schema.timeOffSyncBindings.status, lastSyncedAt: schema.timeOffSyncBindings.lastSyncedAt })
    .from(schema.timeOffSyncBindings).where(eq(schema.timeOffSyncBindings.entryId, entryId));
  const pending = await tx.select({ id: schema.timeOffSyncJobs.id }).from(schema.timeOffSyncJobs)
    .innerJoin(schema.timeOffSyncBindings, eq(schema.timeOffSyncBindings.id, schema.timeOffSyncJobs.bindingId))
    .where(and(eq(schema.timeOffSyncBindings.entryId, entryId), inArray(schema.timeOffSyncJobs.state, ["pending", "creating", "deleting"]))).limit(1);
  const states = new Set(bindings.map((binding) => binding.status));
  if (pending.length) states.add("pending");
  const status: TimeOffSyncStatus = states.has("uncertain") ? "uncertain" : states.has("conflict") ? "conflict"
    : states.has("credentials_required") ? "credentials_required" : states.has("failed") ? "failed"
      : states.has("pending") ? entry?.cancelledAt ? "cancel_pending" : "pending" : bindings.length ? "synced" : "local";
  const lastSyncedAt = status === "synced" ? new Date() : undefined;
  await tx.update(schema.memberTimeOff).set({ syncStatus: status, ...(lastSyncedAt ? { lastSyncedAt } : {}) })
    .where(eq(schema.memberTimeOff.id, entryId));
  return status;
}

export async function retireRemoteRecord(tx: SyncTransaction, binding: SyncBinding, appId: string) {
  if (binding.remoteId) await tx.insert(schema.timeOffSyncTombstones).values({
    id: nanoid(), allianceId: binding.allianceId, appId, remoteId: binding.remoteId,
  }).onConflictDoNothing();
  await tx.update(schema.timeOffSyncBindings).set({ remoteId: null, remoteSnapshot: null, status: "pending" })
    .where(and(eq(schema.timeOffSyncBindings.id, binding.id), eq(schema.timeOffSyncBindings.allianceId, binding.allianceId)));
}
