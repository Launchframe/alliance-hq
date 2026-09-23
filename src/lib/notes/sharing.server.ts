import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getPerformanceNoteForAlliance } from "@/lib/performance-notes/repository.server";
import type { KnowledgeActor } from "./policy.shared";
import { knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import type { NoteShareInput, NoteShareState } from "./sharing.shared";
import { touchResourceBoards } from "./board-events.server";

export async function listKnowledgePeople(actor: KnowledgeActor, includeSelf = false, db: Pick<KnowledgeTransaction, "select"> = getDb()): Promise<NoteShareState["recipients"]> {
  const people = await db.select({ id: schema.hqUsers.id, name: schema.hqUsers.displayName, role: schema.roles.name, commanderName: schema.hqMemberLinks.memberDisplayName })
    .from(schema.allianceMemberships).innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId))
    .leftJoin(schema.hqMemberLinks, and(eq(schema.hqMemberLinks.hqUserId, schema.hqUsers.id), eq(schema.hqMemberLinks.allianceId, actor.allianceId)))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.status, "active")));
  const recipients = new Map<string, NoteShareState["recipients"][number]>();
  for (const person of people) {
    if (!includeSelf && person.id === actor.hqUserId) continue;
    const name = person.commanderName || (person.name?.includes("@") ? null : person.name);
    if (!recipients.has(person.id) || !recipients.get(person.id)?.name) recipients.set(person.id, { id: person.id, name, role: person.role });
  }
  return [...recipients.values()];
}

export async function loadResourceSharing(actor: KnowledgeActor, resourceId: string): Promise<NoteShareState> {
  const [resource] = await getDb().select().from(schema.knowledgeResources).where(and(eq(schema.knowledgeResources.id, resourceId), knowledgeAccessCondition(actor, schema.knowledgeResources.id, "share")));
  if (!resource) throw new KnowledgeAccessError("not_found");
  const [recipients, grants] = await Promise.all([
    listKnowledgePeople(actor),
    getDb().select({ subjectKind: schema.knowledgeResourceGrants.subjectKind, subjectId: schema.knowledgeResourceGrants.subjectId, role: schema.knowledgeResourceGrants.role })
      .from(schema.knowledgeResourceGrants).where(and(eq(schema.knowledgeResourceGrants.resourceId, resourceId), eq(schema.knowledgeResourceGrants.allianceId, actor.allianceId), inArray(schema.knowledgeResourceGrants.subjectKind, ["user", "officers"]))),
  ]);
  const recipientIds = new Set(recipients.map((person) => person.id));
  return {
    version: resource.version, allianceId: actor.allianceId, recipients,
    grants: grants.filter((grant): grant is NoteShareInput["grants"][number] => {
      if (grant.subjectKind === "officers") return true;
      return grant.subjectKind === "user" && recipientIds.has(grant.subjectId);
    }),
  };
}

export async function saveResourceSharing(actor: KnowledgeActor, resourceId: string, input: NoteShareInput) {
  await getDb().transaction(async (tx) => {
    const resource = await lockKnowledgeResource(tx, actor, resourceId, "share");
    if (resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    const userIds = [...new Set(input.grants.filter((grant) => grant.subjectKind === "user").map((grant) => grant.subjectId))];
    const memberships = userIds.length ? await tx.select({ id: schema.hqUsers.id }).from(schema.allianceMemberships)
      .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
      .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.status, "active"), inArray(schema.hqUsers.id, userIds))).for("share") : [];
    const eligible = new Set(memberships.map((member) => member.id));
    if (input.grants.some((grant) => grant.subjectKind === "officers" ? grant.subjectId !== actor.allianceId : grant.subjectId === actor.hqUserId || !eligible.has(grant.subjectId))) throw new KnowledgeAccessError("invalid");
    const grants = new Map(input.grants.map((grant) => [`${grant.subjectKind}:${grant.subjectId}`, grant]));
    await tx.delete(schema.knowledgeResourceGrants).where(and(eq(schema.knowledgeResourceGrants.resourceId, resourceId), eq(schema.knowledgeResourceGrants.allianceId, actor.allianceId), inArray(schema.knowledgeResourceGrants.subjectKind, ["user", "officers"])));
    if (grants.size) await tx.insert(schema.knowledgeResourceGrants).values([...grants.values()].map((grant) => ({ ...grant, id: nanoid(), resourceId: resourceId, allianceId: actor.allianceId, createdByHqUserId: actor.hqUserId })));
    await tx.update(schema.knowledgeResources).set({ accessVersion: sql`${schema.knowledgeResources.accessVersion} + 1` }).where(eq(schema.knowledgeResources.id, resource.id));
    await touchKnowledgeResource(tx, resource.id);
    if (resource.kind === "task") await touchResourceBoards(tx, resource.id);
  });
  return loadResourceSharing(actor, resourceId);
}

export async function loadNoteSharing(actor: KnowledgeActor, noteId: string) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  return loadResourceSharing(actor, note.resourceId);
}

export async function saveNoteSharing(actor: KnowledgeActor, noteId: string, input: NoteShareInput) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  return saveResourceSharing(actor, note.resourceId, input);
}
