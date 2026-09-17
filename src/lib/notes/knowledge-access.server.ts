import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { KnowledgeActor } from "./policy.shared";
import { knowledgeAccessCondition, KnowledgeAccessError, recheckKnowledgeActor, type KnowledgeTransaction } from "./resources.server";
import { KNOWLEDGE_MAX_CHARS, type KnowledgePiece } from "./knowledge.shared";

export const knowledgeResources = schema.knowledgeResources;
const reference = { id: sql`knowledge_resources.id`, allianceId: sql`knowledge_resources.alliance_id`, entityId: sql`knowledge_resources.entity_id`, kind: sql`knowledge_resources.kind`, archivedAt: sql`knowledge_resources.archived_at`, ownerHqUserId: sql`knowledge_resources.owner_hq_user_id` };
export function knowledgeReadyCondition(includeArchived = false) {
  const r = reference;
  return and(includeArchived ? undefined : isNull(r.archivedAt), sql`(
    (${r.kind} = 'note' and exists(select 1 from performance_notes n where n.id = ${r.entityId} and n.resource_id = ${r.id} and n.alliance_id = ${r.allianceId} and n.expunged_at is null))
    or (${r.kind} = 'task' and exists(select 1 from officer_action_items a where a.id = ${r.entityId} and a.resource_id = ${r.id} and a.alliance_id = ${r.allianceId}))
    or (${r.kind} = 'source' and exists(select 1 from officer_chat_sessions s where s.id = ${r.entityId} and s.resource_id = ${r.id} and s.alliance_id = ${r.allianceId} and s.status = 'imported' and not exists(select 1 from knowledge_history_imports h where h.id = s.id and h.state <> 'committed')))
  )`)!;
}
export function knowledgeTitle() {
  const r = reference;
  return sql<string>`case ${r.kind} when 'note' then (select title from performance_notes where id = ${r.entityId} and resource_id = ${r.id}) when 'task' then (select title from officer_action_items where id = ${r.entityId} and resource_id = ${r.id}) else (select title from officer_chat_sessions where id = ${r.entityId} and resource_id = ${r.id}) end`;
}
export async function getKnowledgeResource(actor: KnowledgeActor, id: string, owner = false) {
  const [resource] = await getDb().select().from(knowledgeResources).where(and(eq(knowledgeResources.id, id), eq(knowledgeResources.allianceId, actor.allianceId), knowledgeAccessCondition(actor, knowledgeResources.id, owner ? "share" : "read"), owner ? sql`${knowledgeResources.kind} in ('note','task','source')` : knowledgeReadyCondition()));
  if (!resource) throw new KnowledgeAccessError("not_found");
  return resource;
}
export async function recheckKnowledgeReader(tx: KnowledgeTransaction, actor: KnowledgeActor & { sessionId?: string }) {
  await recheckKnowledgeActor(tx, actor);
  const allowed = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.allianceMemberships).innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId!), eq(schema.allianceMemberships.status, "active"), inArray(schema.rolePermissions.permissionId, ["notes:read", "members:read"]))).orderBy(schema.rolePermissions.permissionId).for("share");
  if (new Set(allowed.map((row) => row.id)).size !== 2) throw new KnowledgeAccessError("forbidden");
}
export async function knowledgeMemberMayProcess(tx: KnowledgeTransaction, identity: { allianceId: string; ownerHqUserId: string }) {
  const rows = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.allianceMemberships).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId)).innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(and(eq(schema.allianceMemberships.allianceId, identity.allianceId), eq(schema.allianceMemberships.hqUserId, identity.ownerHqUserId), eq(schema.allianceMemberships.status, "active"), inArray(schema.roles.name, ["owner", "maintainer", "officer"]), inArray(schema.rolePermissions.permissionId, ["notes:create", "notes:read", "members:read"]))).orderBy(schema.rolePermissions.permissionId).for("share");
  return new Set(rows.map((row) => row.id)).size === 3;
}
export function knowledgeOwnerEligibleCondition() {
  const r = reference;
  return sql`exists(select 1 from alliance_memberships km join roles krole on krole.id = km.role_id join role_permissions kp on kp.role_id = krole.id and kp.permission_id = 'notes:create' where km.hq_user_id = ${r.ownerHqUserId} and km.alliance_id = ${r.allianceId} and km.status = 'active' and krole.name in ('owner','maintainer','officer') and exists(select 1 from role_permissions krp where krp.role_id = krole.id and krp.permission_id = 'notes:read') and exists(select 1 from role_permissions krp where krp.role_id = krole.id and krp.permission_id = 'members:read'))`;
}
export async function loadKnowledgePieces(tx: KnowledgeTransaction, resource: typeof knowledgeResources.$inferSelect): Promise<KnowledgePiece[]> {
  if (resource.kind === "note") {
    const [size] = await tx.select({ value: sql<number>`octet_length(title) + octet_length(body) + octet_length(key_decisions::text) + octet_length(open_questions::text)` }).from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, resource.entityId), eq(schema.performanceNotes.resourceId, resource.id)));
    if (!size || Number(size.value) > KNOWLEDGE_MAX_CHARS) throw new Error("too_large");
    const [note] = await tx.select().from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, resource.entityId), eq(schema.performanceNotes.resourceId, resource.id)));
    const sourceDate = note.journalDate;
    return [{ locator: "title", text: note.title, sourceDate }, { locator: "body", text: note.body, sourceDate }, ...note.keyDecisions.map((text, index) => ({ locator: `decision:${index}`, text, sourceDate })), ...note.openQuestions.map((text, index) => ({ locator: `question:${index}`, text, sourceDate }))];
  }
  if (resource.kind === "task") {
    const [size] = await tx.select({ value: sql<number>`octet_length(title) + coalesce(octet_length(description), 0)` }).from(schema.officerActionItems).where(and(eq(schema.officerActionItems.id, resource.entityId), eq(schema.officerActionItems.resourceId, resource.id)));
    if (!size || Number(size.value) > KNOWLEDGE_MAX_CHARS) throw new Error("too_large");
    const [task] = await tx.select().from(schema.officerActionItems).where(and(eq(schema.officerActionItems.id, resource.entityId), eq(schema.officerActionItems.resourceId, resource.id)));
    if (!task) throw new KnowledgeAccessError("not_found");
    return [{ locator: "title", text: task.title, sourceDate: null }, { locator: "description", text: task.description ?? "", sourceDate: null }];
  }
  if (resource.kind !== "source") throw new KnowledgeAccessError("invalid");
  const [size] = await tx.select({ value: sql<number>`coalesce(sum(octet_length(original_text) + coalesce(octet_length(sender_name), 0) + 2), 0)`, count: sql<number>`count(*)` }).from(schema.officerChatMessages).where(and(eq(schema.officerChatMessages.sessionId, resource.entityId), eq(schema.officerChatMessages.allianceId, resource.allianceId), eq(schema.officerChatMessages.historyIncluded, true)));
  if (!Number(size.count)) throw new Error("empty");
  if (Number(size.value) > KNOWLEDGE_MAX_CHARS - 1_000 || Number(size.count) > 5_000) throw new Error("too_large");
  const [source] = await tx.select().from(schema.officerChatSessions).where(and(eq(schema.officerChatSessions.id, resource.entityId), eq(schema.officerChatSessions.resourceId, resource.id)));
  const rows = await tx.select().from(schema.officerChatMessages).where(and(eq(schema.officerChatMessages.sessionId, resource.entityId), eq(schema.officerChatMessages.allianceId, resource.allianceId), eq(schema.officerChatMessages.historyIncluded, true))).orderBy(schema.officerChatMessages.sequenceOrder, schema.officerChatMessages.id);
  return [{ locator: "title", text: source.title, sourceDate: source.sessionAt?.toISOString() ?? null }, ...rows.map((row) => ({ locator: `message:${row.id}`, text: `${row.senderName ? `${row.senderName}\n` : ""}${row.originalText}`, sourceDate: row.sentAt?.toISOString() ?? source.sessionAt?.toISOString() ?? null }))];
}
