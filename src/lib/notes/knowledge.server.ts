import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { KnowledgeWebActor } from "./access.server";
import { knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource } from "./resources.server";
import { getKnowledgeResource, knowledgeMemberMayProcess, knowledgeReadyCondition, knowledgeTitle } from "./knowledge-access.server";
import { knowledgeCommandSchema, type KnowledgeCommand, type KnowledgeStatus } from "./knowledge.shared";
import { knowledgeJobMatches, queueKnowledgeIndex } from "./knowledge-index.server";
import { withKnowledgeReceipt } from "./mutations.server";
import { redactIntakeText } from "./intake.shared";
import { knowledgeEmbeddingConfigured, knowledgeEmbeddingModel } from "@/lib/officer-intel/embed-corpus.server";

const r = schema.knowledgeResources;
const jobs = schema.knowledgeIndexJobs;
export async function getKnowledgeStatus(actor: KnowledgeWebActor, resourceId: string): Promise<KnowledgeStatus> {
  const resource = await getKnowledgeResource(actor, resourceId, true);
  const [row] = await getDb().select({ title: knowledgeTitle(), ready: knowledgeReadyCondition() }).from(r).where(eq(r.id, resource.id));
  const [job] = await getDb().select().from(jobs).where(eq(jobs.resourceId, resource.id)).orderBy(sql`case when content_version = ${resource.contentVersion} and access_version = ${resource.accessVersion} and approval_version = ${resource.knowledgeApprovalVersion} and consent_version = ${resource.knowledgeConsentVersion} and model = ${knowledgeEmbeddingModel()} then 1 else 0 end desc`, desc(jobs.createdAt), desc(jobs.id)).limit(1);
  const current = !!job && knowledgeJobMatches(job, resource);
  return { resourceId, kind: resource.kind as KnowledgeStatus["kind"], entityId: resource.entityId, title: redactIntakeText(row.title ?? ""),
    href: resource.kind === "note" ? `/notes/${resource.entityId}` : resource.kind === "task" ? `/notes?view=tasks&task=${encodeURIComponent(resource.entityId)}` : actor.isOfficer ? `/officer-intel/sessions/${resource.entityId}` : null,
    version: resource.version, contentVersion: resource.contentVersion, approved: resource.knowledgeApprovedVersion === resource.contentVersion, aiAllowed: resource.knowledgeAiAllowed,
    isOwner: true, canEnable: actor.canCreate && row.ready === true, configured: knowledgeEmbeddingConfigured(), indexState: !job ? "none" : current ? job.state : "outdated",
    completedChunks: current ? job.cursor : 0, totalChunks: current ? job.totalChunks : null, errorCode: current ? job.errorCode : null,
  };
}
export async function listKnowledgeResources(actor: KnowledgeWebActor, owned: boolean, offset: number) {
  // Owned catalog includes archived so owners can still cancel indexing or withdraw consent.
  const includeArchived = owned;
  const rows = await getDb().select({ id: r.id, kind: r.kind, entityId: r.entityId, title: knowledgeTitle(), isOwner: knowledgeAccessCondition(actor, sql`knowledge_resources.id`, "share") }).from(r)
    .where(and(eq(r.allianceId, actor.allianceId), knowledgeReadyCondition(includeArchived), knowledgeAccessCondition(actor, r.id, owned ? "share" : "read"), owned ? undefined : eq(r.knowledgeApprovedVersion, r.contentVersion)))
    .orderBy(desc(r.updatedAt), desc(r.id)).limit(51).offset(offset);
  return { nextOffset: rows.length > 50 && offset < 5_000 ? offset + 50 : null, resources: rows.slice(0, 50).map((row) => ({ resourceId: row.id, kind: row.kind, entityId: row.entityId, title: redactIntakeText(row.title ?? ""), isOwner: row.isOwner === true })) };
}
export async function changeKnowledge(actor: KnowledgeWebActor, resourceId: string, raw: KnowledgeCommand) {
  const input = knowledgeCommandSchema.parse(raw);
  await getKnowledgeResource(actor, resourceId, true);
  return withKnowledgeReceipt(actor, `notes.knowledge_${input.command}`, input.requestId, { resourceId, ...input }, async (tx) => {
    const restricting = ["unapprove", "deny_ai", "cancel"].includes(input.command);
    if (!restricting && (!actor.canCreate || !await knowledgeMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! }))) throw new KnowledgeAccessError("forbidden");
    const resource = await lockKnowledgeResource(tx, actor, resourceId, "share");
    if (!restricting) {
      if (resource.version !== input.expectedVersion || resource.contentVersion !== input.expectedContentVersion) throw new KnowledgeAccessError("changed");
      const [ready] = await tx.select({ id: r.id }).from(r).where(and(eq(r.id, resource.id), knowledgeReadyCondition()));
      if (!ready) throw new KnowledgeAccessError("forbidden");
    }
    let jobId: string | undefined;
    if (input.command === "approve" || input.command === "unapprove") {
      const approve = input.command === "approve";
      await tx.update(r).set({ knowledgeApprovedVersion: approve ? input.expectedContentVersion : null, knowledgeApprovedByHqUserId: approve ? actor.hqUserId : null, knowledgeApprovedAt: approve ? new Date() : null }).where(eq(r.id, resource.id));
      if (resource.kind === "note") await tx.update(schema.officerMeetingNotes).set({ status: approve ? "approved" : "draft", approvedAt: approve ? new Date() : null, approvedByHqUserId: approve ? actor.hqUserId : null }).where(and(eq(schema.officerMeetingNotes.canonicalNoteId, resource.entityId), eq(schema.officerMeetingNotes.resourceId, resource.id)));
    } else if (input.command === "allow_ai" || input.command === "deny_ai") {
      await tx.update(r).set({ knowledgeAiAllowed: input.command === "allow_ai" }).where(eq(r.id, resource.id));
    } else if (input.command === "cancel") {
      await tx.update(jobs).set({ state: "cancelled", leaseToken: null, leaseExpiresAt: null, errorCode: "cancelled", updatedAt: new Date() }).where(and(eq(jobs.resourceId, resource.id), inArray(jobs.state, ["pending", "running"])));
    } else jobId = await queueKnowledgeIndex(tx, resource, input.command === "retry");
    await touchKnowledgeResource(tx, resource.id);
    return { resourceId, ...(jobId ? { jobId } : {}) };
  });
}
