import "server-only";

import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import { embedKnowledgeTexts, knowledgeEmbeddingConfigured, knowledgeEmbeddingModel } from "@/lib/officer-intel/embed-corpus.server";
import { knowledgeHash } from "./mutations.server";
import { KnowledgeAccessError, type KnowledgeTransaction } from "./resources.server";
import { knowledgeMemberMayProcess, knowledgeReadyCondition, loadKnowledgePieces } from "./knowledge-access.server";
import { reserveKnowledgeUsage } from "./knowledge-budget.server";
import { buildKnowledgeChunks, knowledgeChunkFingerprint, KNOWLEDGE_BATCH_SIZE, KNOWLEDGE_CHUNK_CHARS, KNOWLEDGE_MAX_CHUNKS, KNOWLEDGE_DIMENSIONS, KNOWLEDGE_FORMAT_VERSION, validKnowledgeEmbedding, type KnowledgeChunk, type KnowledgeJobState } from "./knowledge.shared";

const jobs = schema.knowledgeIndexJobs;
const resources = schema.knowledgeResources;
export type KnowledgeIndexJob = typeof jobs.$inferSelect;
export const KNOWLEDGE_LEASE_MS = 90_000;
export function knowledgeJobMatches(job: KnowledgeIndexJob, resource: typeof resources.$inferSelect) {
  return job.resourceId === resource.id && job.allianceId === resource.allianceId && job.ownerHqUserId === resource.ownerHqUserId && resource.ownershipState === "hq" && !resource.archivedAt && resource.knowledgeAiAllowed && resource.knowledgeApprovedVersion === resource.contentVersion
    && job.contentVersion === resource.contentVersion && job.accessVersion === resource.accessVersion && job.approvalVersion === resource.knowledgeApprovalVersion && job.consentVersion === resource.knowledgeConsentVersion
    && job.model === knowledgeEmbeddingModel() && job.dimensions === KNOWLEDGE_DIMENSIONS && job.formatVersion === KNOWLEDGE_FORMAT_VERSION;
}
export async function queueKnowledgeIndex(tx: KnowledgeTransaction, resource: typeof resources.$inferSelect, retry: boolean) {
  if (!knowledgeEmbeddingConfigured()) throw new KnowledgeAccessError("not_configured");
  if (resource.ownershipState !== "hq" || resource.archivedAt || !resource.ownerHqUserId || !resource.knowledgeAiAllowed || resource.knowledgeApprovedVersion !== resource.contentVersion) throw new KnowledgeAccessError("changed");
  const [ready] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resource.id), knowledgeReadyCondition()));
  if (!ready) throw new KnowledgeAccessError("forbidden");
  const [existing] = await tx.select().from(jobs).where(and(eq(jobs.resourceId, resource.id), eq(jobs.contentVersion, resource.contentVersion), eq(jobs.accessVersion, resource.accessVersion), eq(jobs.approvalVersion, resource.knowledgeApprovalVersion), eq(jobs.consentVersion, resource.knowledgeConsentVersion), eq(jobs.model, knowledgeEmbeddingModel()), eq(jobs.formatVersion, KNOWLEDGE_FORMAT_VERSION)));
  if (existing) {
    if (["failed", "cancelled"].includes(existing.state)) {
      if (!retry) throw new KnowledgeAccessError("changed");
      await tx.update(jobs).set({ state: "pending", attempts: 0, errorCode: null, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, existing.id));
    }
    return existing.id;
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-queue:${resource.ownerHqUserId}`}, 0))`);
  const [quota] = await tx.select({ active: sql<number>`count(*) filter(where state in ('pending','running'))`, recent: sql<number>`count(*) filter(where created_at > now() - interval '1 day')` }).from(jobs).where(eq(jobs.ownerHqUserId, resource.ownerHqUserId));
  if (Number(quota.active) >= 5 || Number(quota.recent) >= 30) throw new Error("rate_limited");
  const id = nanoid();
  await tx.insert(jobs).values({ id, allianceId: resource.allianceId, resourceId: resource.id, ownerHqUserId: resource.ownerHqUserId, contentVersion: resource.contentVersion, accessVersion: resource.accessVersion, approvalVersion: resource.knowledgeApprovalVersion, consentVersion: resource.knowledgeConsentVersion, model: knowledgeEmbeddingModel() });
  return id;
}
async function lockIndexJob(tx: KnowledgeTransaction, id: string, skipLocked = false) {
  const [initial] = await tx.select().from(jobs).where(eq(jobs.id, id));
  if (!initial) return null;
  const member = await knowledgeMemberMayProcess(tx, initial);
  const [resource] = await tx.select().from(resources).where(and(eq(resources.id, initial.resourceId), eq(resources.allianceId, initial.allianceId))).for("update", skipLocked ? { skipLocked: true } : {});
  if (!resource) return null;
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
  const [ready] = await tx.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resource.id), knowledgeReadyCondition()));
  return { job, resource, authorized: !!member && !!ready && knowledgeJobMatches(job, resource) };
}
async function stop(tx: KnowledgeTransaction, id: string, state: KnowledgeJobState, code: string) {
  await tx.update(jobs).set({ state, errorCode: code, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}
export async function claimKnowledgeIndex(resourceId?: string) {
  if (!knowledgeEmbeddingConfigured()) return null;
  const now = new Date();
  const candidates = await getDb().select({ id: jobs.id }).from(jobs).where(and(resourceId ? eq(jobs.resourceId, resourceId) : undefined, lte(jobs.availableAt, now), or(eq(jobs.state, "pending"), and(eq(jobs.state, "running"), lte(jobs.leaseExpiresAt, now))))).orderBy(asc(jobs.availableAt)).limit(10);
  for (const candidate of candidates) {
    const lease = await getDb().transaction(async (tx) => {
      const held = await lockIndexJob(tx, candidate.id, true);
      if (!held) return null;
      const { job } = held;
      if (!["pending", "running"].includes(job.state) || job.availableAt > new Date() || job.state === "running" && job.leaseExpiresAt && job.leaseExpiresAt > new Date()) return null;
      if (!held.authorized) { await stop(tx, job.id, "cancelled", "changed"); return null; }
      if (job.attempts >= 3) { await stop(tx, job.id, "failed", "attempt_limit"); return null; }
      const [claimed] = await tx.update(jobs).set({ state: "running", attempts: job.attempts + 1, leaseToken: nanoid(), leaseExpiresAt: new Date(Date.now() + KNOWLEDGE_LEASE_MS), updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning();
      return claimed;
    });
    if (lease) return lease;
  }
  return null;
}
function liveLease(job: KnowledgeIndexJob, lease: KnowledgeIndexJob) { return job.state === "running" && job.leaseToken === lease.leaseToken && job.cursor === lease.cursor && job.leaseExpiresAt && job.leaseExpiresAt > new Date(); }
async function prepareBatch(lease: KnowledgeIndexJob) {
  return getDb().transaction(async (tx) => {
    const held = await lockIndexJob(tx, lease.id);
    if (!held || !liveLease(held.job, lease)) return null;
    if (!held.authorized) { await stop(tx, lease.id, "cancelled", "changed"); return null; }
    const chunks = buildKnowledgeChunks(await loadKnowledgePieces(tx, held.resource));
    if (!chunks.length) throw new Error("empty");
    const hash = knowledgeHash(chunks);
    if (held.job.manifestHash && held.job.manifestHash !== hash || lease.cursor > chunks.length) throw new Error("changed");
    const batch = chunks.slice(lease.cursor, lease.cursor + KNOWLEDGE_BATCH_SIZE);
    if (batch.length) await reserveKnowledgeUsage(tx, lease.allianceId, `hq:${lease.ownerHqUserId}`, "index", batch.reduce((total, item) => total + item.text.length, 0));
    await tx.update(jobs).set({ manifestHash: hash, totalChunks: chunks.length }).where(eq(jobs.id, lease.id));
    return { batch, total: chunks.length, hash };
  });
}
export async function completeKnowledgeBatch(lease: KnowledgeIndexJob, batch: KnowledgeChunk[], embeddings: number[][], total: number, hash: string) {
  if (batch.length !== embeddings.length || embeddings.some((value) => !validKnowledgeEmbedding(value))) throw new Error("invalid_embedding");
  if (!Number.isInteger(total) || total <= 0 || total > KNOWLEDGE_MAX_CHUNKS || batch.length > KNOWLEDGE_BATCH_SIZE || lease.cursor + batch.length > total || !batch.length && lease.cursor !== total || batch.some((chunk) => !chunk.text || chunk.text.length > KNOWLEDGE_CHUNK_CHARS || !chunk.evidence.length || chunk.evidence.length > 32)) throw new Error("too_large");
  return getDb().transaction(async (tx) => {
    const held = await lockIndexJob(tx, lease.id);
    if (!held || !liveLease(held.job, lease)) return false;
    if (!held.authorized) { await stop(tx, lease.id, "cancelled", "changed"); return false; }
    if (held.job.manifestHash !== hash || held.job.totalChunks !== total) throw new Error("changed");
    if (batch.length) await tx.insert(schema.officerIntelChunks).values(batch.map((chunk, index) => ({
      id: `${lease.id}:${lease.cursor + index}`, allianceId: lease.allianceId, resourceId: held.resource.id, indexJobId: lease.id, chunkIndex: lease.cursor + index,
      sourceType: `knowledge_${held.resource.kind}`, sourceId: held.resource.entityId, localeCode: "und", chunkText: chunk.text, evidence: chunk.evidence, contentHash: knowledgeHash(knowledgeChunkFingerprint(chunk)), embedding: embeddings[index],
      embeddingModel: lease.model, embeddingDimensions: KNOWLEDGE_DIMENSIONS, formatVersion: KNOWLEDGE_FORMAT_VERSION, contentVersion: lease.contentVersion, accessVersion: lease.accessVersion, approvalVersion: lease.approvalVersion, consentVersion: lease.consentVersion,
      approvedAt: held.resource.knowledgeApprovedAt,
    })));
    if (!liveLease(held.job, lease)) throw new Error("changed");
    const cursor = lease.cursor + batch.length;
    await tx.update(jobs).set({ cursor, state: cursor === total ? "completed" : "pending", attempts: 0, errorCode: null, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, lease.id));
    return true;
  });
}
async function failBatch(lease: KnowledgeIndexJob, error: unknown) {
  const code = error instanceof Error && ["too_large", "empty", "rate_limited", "invalid_embedding", "changed"].includes(error.message) ? error.message : "processing_failed";
  await getDb().transaction(async (tx) => {
    const held = await lockIndexJob(tx, lease.id);
    if (!held || !liveLease(held.job, lease)) return;
    if (!held.authorized || code === "changed") return stop(tx, lease.id, "cancelled", "changed");
    if (held.job.attempts >= 3 || code !== "processing_failed") return stop(tx, lease.id, "failed", code);
    await tx.update(jobs).set({ state: "pending", errorCode: code, leaseToken: null, leaseExpiresAt: null, availableAt: new Date(Date.now() + 5_000 * held.job.attempts), updatedAt: new Date() }).where(eq(jobs.id, lease.id));
  });
}
export async function processKnowledgeIndex(resourceId?: string, sessionId?: string) {
  const lease = await claimKnowledgeIndex(resourceId);
  if (!lease) return { processed: false };
  try {
    const prepared = await prepareBatch(lease);
    if (!prepared) return { processed: false };
    const embeddings = prepared.batch.length ? await embedKnowledgeTexts(prepared.batch.map((chunk) => chunk.text)) : [];
    const processed = await completeKnowledgeBatch(lease, prepared.batch, embeddings, prepared.total, prepared.hash);
    if (processed) await writeOfficerActionAudit({ sessionId: sessionId ?? null, allianceId: lease.allianceId, hqUserId: lease.ownerHqUserId, action: "notes.knowledge_index_step", severity: "routine", permission: "notes:create", resourceType: "knowledge_resource", resourceId: lease.resourceId, metadata: { jobId: lease.id, cursor: lease.cursor, chunks: prepared.batch.length } });
    return { processed };
  } catch (error) { await failBatch(lease, error); return { processed: false }; }
}
