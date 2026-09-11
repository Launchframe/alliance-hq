import "server-only";

import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { knowledgeActorIsAuthenticated, type KnowledgeAccess, type KnowledgeActor, type KnowledgeResourceKind } from "./policy.shared";

export type KnowledgeTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export class KnowledgeAccessError extends Error {
  constructor(public readonly code: "forbidden" | "not_found" | "changed", public readonly status = code === "forbidden" ? 403 : code === "not_found" ? 404 : 409) {
    super(code);
  }
}

export function knowledgeAccessCondition(actor: KnowledgeActor, resourceId: SQLWrapper, access: KnowledgeAccess = "read") {
  if (!knowledgeActorIsAuthenticated(actor)) return sql`false`;
  const officer = actor.kind === "web" && actor.isOfficer;
  const boardIds = access === "edit" ? actor.editableBoardIds : actor.readableBoardIds;
  const boardGrant = officer && boardIds.length
    ? sql`(kg.subject_kind = 'board' and kg.subject_id in (${sql.join(boardIds.map((id) => sql`${id}`), sql`, `)}))`
    : sql`false`;
  return sql`exists (
    select 1 from knowledge_resources kr
    where kr.id = ${resourceId} and kr.alliance_id = ${actor.allianceId}
      and ((kr.ownership_state = 'hq' and kr.owner_hq_user_id is not null)
        or (kr.ownership_state = 'discord' and kr.owner_discord_user_id is not null))
      and (kr.kind <> 'board' or ${officer})
      and (
        (kr.ownership_state = 'hq' and kr.owner_hq_user_id = ${actor.hqUserId})
        or (kr.ownership_state = 'discord' and ${actor.kind === "discord"} and kr.owner_discord_user_id = ${actor.discordUserId})
        or (${access !== "share"} and exists (
          select 1 from knowledge_resource_grants kg
          where kg.resource_id = kr.id and kg.alliance_id = kr.alliance_id
            and (${access !== "edit"} or kg.role = 'edit')
            and ((kg.subject_kind = 'user' and kg.subject_id = ${actor.hqUserId})
              or (kg.subject_kind = 'officers' and kg.subject_id = ${actor.allianceId} and ${officer})
              or ${boardGrant})
        ))
      )
  )`;
}

export async function recheckKnowledgeActor(tx: KnowledgeTransaction, actor: KnowledgeActor & { sessionId?: string }) {
  if (!knowledgeActorIsAuthenticated(actor)) throw new KnowledgeAccessError("forbidden");
  if (actor.kind === "discord") {
    const [link] = await tx.select({ hqUserId: schema.discordHqLinks.hqUserId }).from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, actor.discordUserId!)).for("share");
    if ((link?.hqUserId ?? null) !== actor.hqUserId) throw new KnowledgeAccessError("forbidden");
    return;
  }
  if (!actor.sessionId || !actor.hqUserId) throw new KnowledgeAccessError("forbidden");
  const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.id, actor.sessionId)).for("share");
  if (!session || session.hqUserId !== actor.hqUserId || (session.currentAllianceId ?? session.allianceId) !== actor.allianceId || session.expiresAt <= new Date()) throw new KnowledgeAccessError("forbidden");
  const [membership] = await tx.select({ role: schema.roles.name }).from(schema.allianceMemberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId), eq(schema.allianceMemberships.status, "active"))).for("share");
  if (!membership || (actor.isOfficer && !["owner", "maintainer", "officer"].includes(membership.role))) throw new KnowledgeAccessError("forbidden");
}

export async function createKnowledgeResource(tx: KnowledgeTransaction, actor: KnowledgeActor, kind: KnowledgeResourceKind, entityId: string) {
  await recheckKnowledgeActor(tx, actor);
  if (kind === "board" && (actor.kind !== "web" || !actor.isOfficer)) throw new KnowledgeAccessError("forbidden");
  const id = `${kind}:${entityId}`;
  await tx.insert(schema.knowledgeResources).values({
    id, allianceId: actor.allianceId, kind, entityId,
    ownershipState: actor.hqUserId ? "hq" : "discord",
    ownerHqUserId: actor.hqUserId, ownerDiscordUserId: actor.discordUserId,
    ownerBoundAt: actor.hqUserId ? new Date() : null,
  });
  return id;
}

export async function lockKnowledgeResource(tx: KnowledgeTransaction, actor: KnowledgeActor, resourceId: string, access: KnowledgeAccess = "edit") {
  await recheckKnowledgeActor(tx, actor);
  const [resource] = await tx.select().from(schema.knowledgeResources)
    .where(and(eq(schema.knowledgeResources.id, resourceId), eq(schema.knowledgeResources.allianceId, actor.allianceId))).for("update");
  if (!resource) throw new KnowledgeAccessError("not_found");
  const [allowed] = await tx.select({ id: schema.knowledgeResources.id }).from(schema.knowledgeResources)
    .where(and(eq(schema.knowledgeResources.id, resourceId), knowledgeAccessCondition(actor, schema.knowledgeResources.id, access)));
  if (!allowed) throw new KnowledgeAccessError("not_found");
  return resource;
}

export async function touchKnowledgeResource(tx: KnowledgeTransaction, resourceId: string) {
  await tx.update(schema.knowledgeResources).set({ version: sql`${schema.knowledgeResources.version} + 1`, updatedAt: new Date() })
    .where(eq(schema.knowledgeResources.id, resourceId));
}

export async function remapKnowledgeUser(tx: KnowledgeTransaction, sourceId: string, canonicalId: string) {
  await tx.update(schema.knowledgeResources).set({
    ownerHqUserId: canonicalId, accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1`,
    version: sql`${schema.knowledgeResources.version} + 1`, updatedAt: new Date(),
  }).where(eq(schema.knowledgeResources.ownerHqUserId, sourceId));
  const grants = await tx.select().from(schema.knowledgeResourceGrants)
    .where(and(eq(schema.knowledgeResourceGrants.subjectKind, "user"), eq(schema.knowledgeResourceGrants.subjectId, sourceId))).for("update");
  for (const grant of grants) {
    await tx.insert(schema.knowledgeResourceGrants).values({ ...grant, id: nanoid(), subjectId: canonicalId })
      .onConflictDoUpdate({
        target: [schema.knowledgeResourceGrants.resourceId, schema.knowledgeResourceGrants.subjectKind, schema.knowledgeResourceGrants.subjectId],
        set: { role: sql`case when knowledge_resource_grants.role = 'edit' or excluded.role = 'edit' then 'edit' else 'read' end` },
      });
  }
  if (grants.length) {
    await tx.update(schema.knowledgeResources).set({ accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1` })
      .where(inArray(schema.knowledgeResources.id, grants.map((grant) => grant.resourceId)));
    await tx.delete(schema.knowledgeResourceGrants)
      .where(and(eq(schema.knowledgeResourceGrants.subjectKind, "user"), eq(schema.knowledgeResourceGrants.subjectId, sourceId)));
  }
  await tx.update(schema.knowledgeResourceGrants).set({ createdByHqUserId: canonicalId }).where(eq(schema.knowledgeResourceGrants.createdByHqUserId, sourceId));
  await tx.update(schema.performanceNotes).set({ createdByHqUserId: canonicalId }).where(eq(schema.performanceNotes.createdByHqUserId, sourceId));
  await tx.update(schema.officerChatSessions).set({ createdByHqUserId: canonicalId }).where(eq(schema.officerChatSessions.createdByHqUserId, sourceId));
  await tx.update(schema.officerMeetingNotes).set({ synthesizedByHqUserId: canonicalId }).where(eq(schema.officerMeetingNotes.synthesizedByHqUserId, sourceId));
  await tx.update(schema.officerMeetingNotes).set({ approvedByHqUserId: canonicalId }).where(eq(schema.officerMeetingNotes.approvedByHqUserId, sourceId));
  await tx.update(schema.officerActionItems).set({ createdByHqUserId: canonicalId }).where(eq(schema.officerActionItems.createdByHqUserId, sourceId));
  await tx.update(schema.officerIntelThreads).set({ createdByHqUserId: canonicalId }).where(eq(schema.officerIntelThreads.createdByHqUserId, sourceId));
}

export async function claimDiscordKnowledgeResources(actor: KnowledgeActor) {
  if (actor.kind !== "web" || !actor.hqUserId) return;
  await getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    const links = await tx.select({ id: schema.discordHqLinks.discordUserId }).from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.hqUserId, actor.hqUserId!)).for("share");
    if (!links.length) return;
    await tx.update(schema.knowledgeResources).set({
      ownershipState: "hq", ownerHqUserId: actor.hqUserId,
      ownerBoundAt: new Date(), accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1`,
    }).where(and(
      eq(schema.knowledgeResources.allianceId, actor.allianceId),
      eq(schema.knowledgeResources.ownershipState, "discord"),
      inArray(schema.knowledgeResources.ownerDiscordUserId, links.map((link) => link.id)),
    ));
  });
}
