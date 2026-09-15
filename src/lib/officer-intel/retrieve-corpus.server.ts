import "server-only";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { escapeLikePrefix } from "@/lib/admin/audit-query";
import type { KnowledgeActor } from "@/lib/notes/policy.shared";
import type { KnowledgeWebActor } from "@/lib/notes/access.server";
import { KnowledgeAccessError, knowledgeAccessCondition } from "@/lib/notes/resources.server";
import { knowledgeReadyCondition, knowledgeOwnerEligibleCondition, recheckKnowledgeReader } from "@/lib/notes/knowledge-access.server";
import { knowledgeQuerySchema, knowledgeChunkFingerprint, KNOWLEDGE_DIMENSIONS, KNOWLEDGE_FORMAT_VERSION, type KnowledgeEvidence, type KnowledgeQuery } from "@/lib/notes/knowledge.shared";
import { reserveKnowledgeUsage } from "@/lib/notes/knowledge-budget.server";
import { knowledgeHash } from "@/lib/notes/mutations.server";
import { redactIntakeText } from "@/lib/notes/intake.shared";
import { embedKnowledgeTexts, knowledgeEmbeddingConfigured, knowledgeEmbeddingModel } from "./embed-corpus.server";
import { formatOfficerIntelEmbeddingLiteral } from "./embedding-query.shared";
import { meetingNoteAccess } from "./repository.server";
import type { OfficerActionItemRecord } from "./synthesis-types.shared";

export type OfficerIntelRetrievedChunk = { id: string; sourceType: "approved_note" | "action_item"; sourceId: string; sessionId: string | null; text: string; sessionTitle: string | null; channelLabel: string | null; sessionAt: string | null; similarity: number };
export function buildOfficerIntelKeywordPattern(query: string): string { return query.trim() ? `%${escapeLikePrefix(query.trim())}%` : "%"; }
const c = schema.officerIntelChunks, j = schema.knowledgeIndexJobs, r = schema.knowledgeResources;
function eligible(actor: KnowledgeActor, includeSources: boolean) {
  return and(eq(c.allianceId, actor.allianceId), eq(j.state, "completed"), eq(j.cursor, j.totalChunks), eq(j.resourceId, r.id), eq(j.allianceId, r.allianceId), eq(j.ownerHqUserId, r.ownerHqUserId), eq(r.ownershipState, "hq"), eq(r.knowledgeAiAllowed, true), eq(r.knowledgeApprovedVersion, r.contentVersion),
    eq(j.contentVersion, r.contentVersion), eq(j.accessVersion, r.accessVersion), eq(j.approvalVersion, r.knowledgeApprovalVersion), eq(j.consentVersion, r.knowledgeConsentVersion),
    eq(c.contentVersion, j.contentVersion), eq(c.accessVersion, j.accessVersion), eq(c.approvalVersion, j.approvalVersion), eq(c.consentVersion, j.consentVersion), eq(c.embeddingModel, j.model), eq(j.model, knowledgeEmbeddingModel()), eq(c.embeddingDimensions, KNOWLEDGE_DIMENSIONS), eq(j.dimensions, KNOWLEDGE_DIMENSIONS), eq(c.formatVersion, KNOWLEDGE_FORMAT_VERSION), eq(j.formatVersion, KNOWLEDGE_FORMAT_VERSION),
    sql`${c.embedding} is not null`, sql`${c.contentHash} is not null`, sql`${c.evidence} is not null`, includeSources ? undefined : inArray(r.kind, ["note", "task"]),
    sql`(select count(*) from officer_intel_chunks kc where kc.index_job_id = ${j.id}) = ${j.totalChunks}`,
    knowledgeReadyCondition(), knowledgeOwnerEligibleCondition(), knowledgeAccessCondition(actor, r.id));
}
function evidenceSelection() {
  return { id: c.id, resourceId: r.id, kind: r.kind, entityId: r.entityId, text: c.chunkText, evidence: c.evidence, contentHash: c.contentHash, contentVersion: c.contentVersion, accessVersion: c.accessVersion, approvalVersion: c.approvalVersion, consentVersion: c.consentVersion, model: c.embeddingModel, jobId: j.id };
}
export async function revalidateKnowledgeEvidence(actor: KnowledgeWebActor, evidence: KnowledgeEvidence[]) {
  if (evidence.length > 6) return false;
  const rows = await getDb().transaction(async (tx) => {
    await recheckKnowledgeReader(tx, actor);
    return evidence.length ? tx.select(evidenceSelection()).from(c).innerJoin(j, eq(j.id, c.indexJobId)).innerJoin(r, eq(r.id, c.resourceId)).where(and(eligible(actor, true), inArray(c.id, evidence.map((item) => item.id)))) : [];
  });
  return evidence.every((item) => rows.some((row) => row.id === item.id && row.resourceId === item.resourceId && row.contentHash === item.contentHash && row.contentVersion === item.contentVersion && row.accessVersion === item.accessVersion && row.approvalVersion === item.approvalVersion && row.consentVersion === item.consentVersion && row.model === item.model && row.jobId === item.jobId));
}
export async function retrieveKnowledgeEvidence(actor: KnowledgeWebActor, raw: KnowledgeQuery): Promise<KnowledgeEvidence[]> {
  const input = knowledgeQuerySchema.parse(raw);
  const query = redactIntakeText(input.q);
  const model = knowledgeEmbeddingModel();
  let embedding: number[] | undefined;
  if (input.mode === "semantic") {
    const [available] = await getDb().select({ id: c.id }).from(c).innerJoin(j, eq(j.id, c.indexJobId)).innerJoin(r, eq(r.id, c.resourceId)).where(eligible(actor, input.includeSources)).limit(1);
    if (!available) return [];
    if (!knowledgeEmbeddingConfigured()) throw new KnowledgeAccessError("not_configured");
    await getDb().transaction(async (tx) => { await recheckKnowledgeReader(tx, actor); await reserveKnowledgeUsage(tx, actor.allianceId, `hq:${actor.hqUserId}`, "query", query.length); });
    [embedding] = await embedKnowledgeTexts([query]);
    if (model !== knowledgeEmbeddingModel()) throw new KnowledgeAccessError("changed");
  }
  const rows = await getDb().select(evidenceSelection()).from(c).innerJoin(j, eq(j.id, c.indexJobId)).innerJoin(r, eq(r.id, c.resourceId))
    .where(and(eligible(actor, input.includeSources), embedding ? undefined : sql`notes_search_vector(${c.chunkText}) @@ plainto_tsquery('simple', ${query})`))
    .orderBy(embedding ? sql`${c.embedding} <=> cast(${formatOfficerIntelEmbeddingLiteral(embedding)} as vector)` : sql`ts_rank_cd(notes_search_vector(${c.chunkText}), plainto_tsquery('simple', ${query})) desc`, c.id).limit(input.limit);
  const evidence = rows.filter((row) => row.evidence && row.contentHash === knowledgeHash(knowledgeChunkFingerprint({ text: row.text, evidence: row.evidence }))).map((row) => ({ ...row, text: redactIntakeText(row.text) })) as KnowledgeEvidence[];
  if (!await revalidateKnowledgeEvidence(actor, evidence)) throw new KnowledgeAccessError("changed");
  return evidence;
}
export async function retrieveOfficerIntelCorpus(input: { allianceId: string; query: string; k?: number }): Promise<OfficerIntelRetrievedChunk[]> {
  void input; throw new KnowledgeAccessError("not_configured");
}
export async function listOpenActionItemsForAsk(_allianceId: string): Promise<OfficerActionItemRecord[]> { return []; }
export async function countApprovedOfficerMeetingNotes(allianceId: string, actor: KnowledgeActor): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(schema.officerMeetingNotes).where(and(eq(schema.officerMeetingNotes.allianceId, allianceId), eq(schema.officerMeetingNotes.status, "approved"), meetingNoteAccess(actor), sql`exists(select 1 from knowledge_resources where id = ${schema.officerMeetingNotes.resourceId} and archived_at is null)`));
  return Number(row?.value ?? 0);
}
export async function loadSessionMessagesForAsk(_input: { allianceId: string; sessionId: string; limit?: number }): Promise<Array<{ senderName: string; localeText: string; sequenceOrder: number }>> { return []; }
