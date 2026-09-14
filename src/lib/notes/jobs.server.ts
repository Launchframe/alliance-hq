import "server-only";

import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { KnowledgeAccessError, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { HISTORY_MESSAGE_LIMIT, redactHistoryMessage, type HistoryMessage } from "./imports.shared";

const jobs = schema.knowledgeProcessingJobs;
const imports = schema.knowledgeHistoryImports;
export const HISTORY_LEASE_MS = 90_000;
export type HistoryJob = typeof jobs.$inferSelect;
export async function queueHistoryJob(tx: KnowledgeTransaction, input: Pick<HistoryJob, "importId" | "allianceId" | "ownerHqUserId" | "sourceVersion" | "accessVersion">) {
  await tx.insert(jobs).values({ id: nanoid(), ...input }).onConflictDoUpdate({ target: jobs.importId, set: { ...input, state: "pending", attempts: 0, errorCode: null, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), updatedAt: new Date() } });
}
export async function historyMemberMayProcess(tx: KnowledgeTransaction, job: Pick<HistoryJob, "allianceId" | "ownerHqUserId">) {
  const [member] = await tx.select({ id: schema.allianceMemberships.hqUserId }).from(schema.allianceMemberships).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .innerJoin(schema.rolePermissions, and(eq(schema.rolePermissions.roleId, schema.roles.id), eq(schema.rolePermissions.permissionId, "notes:create")))
    .where(and(eq(schema.allianceMemberships.hqUserId, job.ownerHqUserId), eq(schema.allianceMemberships.allianceId, job.allianceId), eq(schema.allianceMemberships.status, "active"), inArray(schema.roles.name, ["owner", "maintainer", "officer"]))).for("share");
  return member;
}
async function authority(tx: KnowledgeTransaction, job: HistoryJob, resource: typeof schema.knowledgeResources.$inferSelect) {
  return !!await historyMemberMayProcess(tx, job) && resource.allianceId === job.allianceId && resource.ownershipState === "hq" && resource.ownerHqUserId === job.ownerHqUserId && !resource.archivedAt && resource.version === job.sourceVersion && resource.accessVersion === job.accessVersion;
}
async function lockJob(tx: KnowledgeTransaction, id: string, skipLocked = false) {
  const [initial] = await tx.select().from(jobs).where(eq(jobs.id, id));
  if (!initial) return null;
  const [record] = await tx.select().from(imports).where(and(eq(imports.id, initial.importId), eq(imports.allianceId, initial.allianceId)));
  if (!record) return null;
  await historyMemberMayProcess(tx, initial);
  const [resource] = await tx.select().from(schema.knowledgeResources).where(and(eq(schema.knowledgeResources.id, record.resourceId), eq(schema.knowledgeResources.allianceId, record.allianceId))).for("update", skipLocked ? { skipLocked: true } : {});
  if (!resource) return null;
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
  if (job.ownerHqUserId !== initial.ownerHqUserId) return null;
  const [current] = await tx.select().from(imports).where(eq(imports.id, record.id));
  return { resource, record: current, job };
}
async function stopJob(tx: KnowledgeTransaction, job: HistoryJob, state: "cancelled" | "failed", errorCode: string) {
  await tx.update(jobs).set({ state, errorCode, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
  await tx.update(imports).set({ state, updatedAt: new Date() }).where(and(eq(imports.id, job.importId), inArray(imports.state, ["queued", "processing"])));
}
export async function claimHistoryJob(importId?: string): Promise<HistoryJob | null> {
  const now = new Date();
  const candidates = await getDb().select({ id: jobs.id }).from(jobs).where(and(importId ? eq(jobs.importId, importId) : undefined, lte(jobs.availableAt, now), or(eq(jobs.state, "pending"), and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, now))))).orderBy(asc(jobs.availableAt)).limit(10);
  for (const candidate of candidates) {
    const claimed = await getDb().transaction(async (tx) => {
      const held = await lockJob(tx, candidate.id, true);
      if (!held) return null;
      const { job, resource, record } = held;
      if (job.availableAt > new Date() || !["pending", "running"].includes(job.state) || job.state === "running" && job.leaseExpiresAt && job.leaseExpiresAt > new Date()) return null;
      if (!["queued", "processing"].includes(record.state) || !await authority(tx, job, resource)) { await stopJob(tx, job, "cancelled", "access_changed"); return null; }
      if (job.attempts >= 3) { await stopJob(tx, job, "failed", "attempt_limit"); return null; }
      const [lease] = await tx.update(jobs).set({ state: "running", leaseToken: nanoid(), leaseExpiresAt: new Date(Date.now() + HISTORY_LEASE_MS), attempts: job.attempts + 1, updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning();
      await tx.update(imports).set({ state: "processing", updatedAt: new Date() }).where(eq(imports.id, record.id));
      return lease;
    });
    if (claimed) return claimed;
  }
  return null;
}
export async function completeHistoryStep(lease: HistoryJob, proposed: HistoryMessage[], assetCount: number) {
  const rows = proposed.map(redactHistoryMessage);
  return getDb().transaction(async (tx) => {
    const held = await lockJob(tx, lease.id);
    if (!held) return false;
    const { job, resource, record } = held;
    if (job.state !== "running" || job.leaseToken !== lease.leaseToken || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return false;
    if (record.state !== "processing" || !await authority(tx, job, resource)) { await stopJob(tx, job, "cancelled", "access_changed"); return false; }
    const existing = await tx.select({ id: schema.officerChatMessages.id }).from(schema.officerChatMessages).where(and(eq(schema.officerChatMessages.sessionId, job.importId), eq(schema.officerChatMessages.allianceId, job.allianceId))).limit(HISTORY_MESSAGE_LIMIT + 1);
    if (existing.length + rows.length > HISTORY_MESSAGE_LIMIT) throw new KnowledgeAccessError("invalid");
    for (let offset = 0; offset < rows.length; offset += 100) {
      await tx.insert(schema.officerChatMessages).values(rows.slice(offset, offset + 100).map((row, index) => ({
        id: `${job.importId}:${job.cursor}:${offset + index}`, sessionId: job.importId, allianceId: job.allianceId,
        senderName: row.sender, originalText: row.body, localeText: row.body, localeCode: "und", sourceImageIndex: row.sourceImageIndex,
        sourceLocator: row.locator, externalMessageId: row.externalId, sentAt: row.sentAt ? new Date(row.sentAt) : null,
        sequenceOrder: existing.length + offset + index, historyIncluded: !!row.body.trim(), historyReviewed: false,
      })));
    }
    if (job.leaseExpiresAt <= new Date()) throw new KnowledgeAccessError("changed");
    const cursor = Math.min(job.cursor + 1, assetCount);
    const done = cursor >= assetCount;
    await touchKnowledgeResource(tx, resource.id);
    await tx.update(jobs).set({ cursor, sourceVersion: resource.version + 1, state: done ? "completed" : "pending", attempts: 0, errorCode: null, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await tx.update(imports).set({ state: done ? "review" : "queued", updatedAt: new Date() }).where(eq(imports.id, record.id));
    return true;
  });
}
export async function failHistoryStep(lease: HistoryJob) {
  await getDb().transaction(async (tx) => {
    const held = await lockJob(tx, lease.id);
    if (!held || held.job.state !== "running" || held.job.leaseToken !== lease.leaseToken || !held.job.leaseExpiresAt || held.job.leaseExpiresAt <= new Date()) return;
    const { job, resource } = held;
    if (!await authority(tx, job, resource)) return stopJob(tx, job, "cancelled", "access_changed");
    if (job.attempts >= 3) return stopJob(tx, job, "failed", "processing_failed");
    await tx.update(jobs).set({ state: "pending", errorCode: "processing_failed", leaseToken: null, leaseExpiresAt: null, availableAt: new Date(Date.now() + 5_000 * job.attempts), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await tx.update(imports).set({ state: "queued", updatedAt: new Date() }).where(eq(imports.id, job.importId));
  });
}
