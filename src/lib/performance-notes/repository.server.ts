import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { knowledgeActorOwnsResource, type KnowledgeAccess, type KnowledgeActor } from "@/lib/notes/policy.shared";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource, type KnowledgeTransaction } from "@/lib/notes/resources.server";
import type { NoteFields, NotePatch } from "@/lib/notes/workspace.shared";
import type { PerformanceNoteDto, PerformanceNoteIntakeMode, PerformanceNoteKind, PerformanceNoteRosterMember } from "./types.shared";

function isNoteKind(value: string): value is PerformanceNoteKind {
  return value === "commendation" || value === "violation" || value === "note";
}

function isIntakeMode(value: string): value is PerformanceNoteIntakeMode {
  return value === "batch" || value === "thought";
}

const resourceJoin = and(eq(schema.knowledgeResources.id, schema.performanceNotes.resourceId), eq(schema.knowledgeResources.kind, "note"), eq(schema.knowledgeResources.entityId, schema.performanceNotes.id));
const noteSelection = (actor: KnowledgeActor) => ({
  note: schema.performanceNotes, version: schema.knowledgeResources.version,
  archivedAt: schema.knowledgeResources.archivedAt,
  canEdit: knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "edit"),
  isOwner: knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "share"),
  shared: sql<boolean>`exists (select 1 from knowledge_resource_grants g where g.resource_id = ${schema.performanceNotes.resourceId} and g.alliance_id = ${actor.allianceId})`,
});
type ReadableNote = typeof schema.performanceNotes.$inferSelect & { version: number; canEdit: boolean; isOwner: boolean; archived: boolean; shared: boolean };
const readableNote = (row: { note: typeof schema.performanceNotes.$inferSelect; version: number; archivedAt: Date | null; canEdit: unknown; isOwner: unknown; shared: boolean }): ReadableNote => ({
  ...row.note, version: row.version, archived: row.archivedAt !== null, canEdit: row.canEdit === true, isOwner: row.isOwner === true, shared: row.shared === true,
});

async function setNoteMembers(tx: KnowledgeTransaction, actor: KnowledgeActor, noteId: string, ids: string[], detectedIds: string[] = []) {
  const selected = [...new Set(ids)];
  const previous = await tx.select().from(schema.performanceNoteMembers)
    .where(and(eq(schema.performanceNoteMembers.noteId, noteId), eq(schema.performanceNoteMembers.allianceId, actor.allianceId)));
  const roster = selected.length ? await tx.select({ id: schema.allianceMembers.id, memberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
    .from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, actor.allianceId), inArray(schema.allianceMembers.ashedMemberId, selected))) : [];
  const byId = new Map(roster.map((member) => [member.memberId, member]));
  const previousById = new Map(previous.map((member) => [member.ashedMemberId, member]));
  if (selected.some((id) => !byId.has(id) && !previousById.has(id))) throw new KnowledgeAccessError("invalid");
  const selectedIds = new Set(selected);
  const removed = previous.filter((member) => !selectedIds.has(member.ashedMemberId)).map((member) => member.id);
  if (removed.length) await tx.delete(schema.performanceNoteMembers).where(and(eq(schema.performanceNoteMembers.noteId, noteId), eq(schema.performanceNoteMembers.allianceId, actor.allianceId), inArray(schema.performanceNoteMembers.id, removed)));
  if (selected.length) {
    const detected = new Set(detectedIds);
    await tx.insert(schema.performanceNoteMembers).values(selected.map((id) => ({
      id: nanoid(), noteId, allianceId: actor.allianceId, ashedMemberId: id,
      allianceMemberId: byId.get(id)?.id ?? previousById.get(id)?.allianceMemberId ?? null,
      memberNameRaw: byId.get(id)?.name ?? previousById.get(id)!.memberNameRaw,
      origin: detected.has(id) ? "detected" as const : "manual" as const,
    }))).onConflictDoUpdate({
      target: [schema.performanceNoteMembers.noteId, schema.performanceNoteMembers.ashedMemberId],
      set: { origin: sql`excluded.origin` },
    });
  }
  return previous;
}

export async function createPerformanceNote(input: {
  actor: KnowledgeActor; kind: PerformanceNoteKind; intakeMode: PerformanceNoteIntakeMode; body: string;
} & Partial<Omit<NoteFields, "kind" | "body">>): Promise<string> {
  return getDb().transaction(async (tx) => {
    const id = nanoid();
    const resourceId = await createKnowledgeResource(tx, input.actor, "note", id);
    const now = new Date();
    await tx.insert(schema.performanceNotes).values({
      id, resourceId, allianceId: input.actor.allianceId,
      kind: input.kind, intakeMode: input.intakeMode, body: input.body,
      title: input.title ?? "", priority: input.priority ?? null, labels: input.labels ?? [],
      notebook: input.notebook ?? null, journalDate: input.journalDate ?? null, inbox: input.inbox ?? true,
      excludedMemberIds: input.excludedMemberIds ?? [], source: input.actor.kind,
      createdByDiscordUserId: input.actor.discordUserId, createdByHqUserId: input.actor.hqUserId,
      createdAt: now, updatedAt: now,
    });
    if (input.memberIds?.length) await setNoteMembers(tx, input.actor, id, input.memberIds, input.detectedMemberIds);
    return id;
  });
}

export async function getPerformanceNoteForAlliance(input: { noteId: string; actor: KnowledgeActor; access?: KnowledgeAccess }) {
  const [row] = await getDb().select(noteSelection(input.actor)).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, resourceJoin)
    .where(and(eq(schema.performanceNotes.id, input.noteId), eq(schema.performanceNotes.allianceId, input.actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId, input.access))).limit(1);
  return row ? readableNote(row) : null;
}

export async function updatePerformanceNote(actor: KnowledgeActor, noteId: string, input: NotePatch) {
  const existing = await getPerformanceNoteForAlliance({ actor, noteId, access: "edit" });
  if (!existing) throw new KnowledgeAccessError("not_found");
  await getDb().transaction(async (tx) => {
    const resource = await lockKnowledgeResource(tx, actor, existing.resourceId);
    if (resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    const [note] = await tx.select().from(schema.performanceNotes)
      .where(and(eq(schema.performanceNotes.id, noteId), eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt))).for("update");
    if (!note) throw new KnowledgeAccessError("not_found");
    if (!knowledgeActorOwnsResource(actor, resource) && (input.notebook !== undefined || input.inbox !== undefined || input.archived !== undefined || input.excludedMemberIds !== undefined)) throw new KnowledgeAccessError("forbidden");
    const members = await tx.select().from(schema.performanceNoteMembers)
      .where(and(eq(schema.performanceNoteMembers.noteId, noteId), eq(schema.performanceNoteMembers.allianceId, actor.allianceId)));
    await tx.insert(schema.knowledgeNoteRevisions).values({
      id: nanoid(), noteId, allianceId: actor.allianceId, version: resource.version,
      editedByHqUserId: actor.hqUserId,
      snapshot: {
        title: note.title, body: note.body, kind: isNoteKind(note.kind) ? note.kind : "note",
        priority: note.priority, labels: note.labels, notebook: note.notebook, journalDate: note.journalDate,
        inbox: note.inbox, archived: resource.archivedAt !== null,
        memberIds: members.map((member) => member.ashedMemberId),
        detectedMemberIds: members.filter((member) => member.origin === "detected").map((member) => member.ashedMemberId),
        excludedMemberIds: note.excludedMemberIds,
      },
    });
    let exclusions = input.excludedMemberIds ?? note.excludedMemberIds;
    if (input.memberIds !== undefined) {
      const selected = new Set(input.memberIds);
      exclusions = [...new Set([...exclusions, ...members.filter((member) => !selected.has(member.ashedMemberId)).map((member) => member.ashedMemberId)])].filter((id) => !selected.has(id));
      await setNoteMembers(tx, actor, noteId, input.memberIds, input.detectedMemberIds);
    }
    await tx.update(schema.performanceNotes).set({
      title: input.title, body: input.body, kind: input.kind, priority: input.priority,
      labels: input.labels, notebook: input.notebook, journalDate: input.journalDate,
      inbox: input.inbox, excludedMemberIds: exclusions, updatedAt: new Date(),
    }).where(and(eq(schema.performanceNotes.id, noteId), eq(schema.performanceNotes.allianceId, actor.allianceId)));
    if (input.archived !== undefined) await tx.update(schema.knowledgeResources).set({ archivedAt: input.archived ? new Date() : null }).where(eq(schema.knowledgeResources.id, resource.id));
    await touchKnowledgeResource(tx, resource.id);
  });
  return getPerformanceNoteDto({ actor, noteId });
}

export async function attachMembersToPerformanceNote(input: {
  actor: KnowledgeActor; noteId: string; members: Array<{ ashedMemberId: string; memberNameRaw: string }>;
}): Promise<number> {
  const note = await getPerformanceNoteForAlliance({ noteId: input.noteId, actor: input.actor, access: "edit" });
  if (!note) throw new KnowledgeAccessError("not_found");
  const unique = new Map(input.members.map((member) => [member.ashedMemberId.trim(), member.memberNameRaw.trim()] as const).filter(([id, name]) => id && name));
  if (!unique.size) return 0;
  return getDb().transaction(async (tx) => {
    await lockKnowledgeResource(tx, input.actor, note.resourceId);
    const [current] = await tx.select({ id: schema.performanceNotes.id }).from(schema.performanceNotes)
      .where(and(eq(schema.performanceNotes.id, input.noteId), eq(schema.performanceNotes.allianceId, input.actor.allianceId), eq(schema.performanceNotes.resourceId, note.resourceId), isNull(schema.performanceNotes.expungedAt))).for("update");
    if (!current) throw new KnowledgeAccessError("not_found");
    const local = await tx.select({ id: schema.allianceMembers.id, memberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
      .from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, input.actor.allianceId), inArray(schema.allianceMembers.ashedMemberId, [...unique.keys()])));
    const localById = new Map(local.map((member) => [member.memberId, member]));
    const rows = [...unique.entries()].map(([ashedMemberId, raw]) => ({
      id: nanoid(), noteId: input.noteId, allianceId: input.actor.allianceId,
      allianceMemberId: localById.get(ashedMemberId)?.id ?? null,
      ashedMemberId, memberNameRaw: localById.get(ashedMemberId)?.name ?? raw,
    }));
    const inserted = await tx.insert(schema.performanceNoteMembers).values(rows)
      .onConflictDoNothing({ target: [schema.performanceNoteMembers.noteId, schema.performanceNoteMembers.ashedMemberId] }).returning({ id: schema.performanceNoteMembers.id });
    if (inserted.length) {
      await tx.update(schema.performanceNotes).set({ updatedAt: new Date() }).where(eq(schema.performanceNotes.id, input.noteId));
      await touchKnowledgeResource(tx, note.resourceId);
    }
    return inserted.length;
  });
}

function toDto(note: ReadableNote, members: Array<{ ashedMemberId: string; memberNameRaw: string; origin: string }>): PerformanceNoteDto | null {
  if (!isNoteKind(note.kind) || !isIntakeMode(note.intakeMode) || (note.source !== "web" && note.source !== "discord")) return null;
  return {
    id: note.id, kind: note.kind, intakeMode: note.intakeMode, body: note.body, title: note.title,
    priority: note.priority, labels: note.labels, journalDate: note.journalDate,
    notebook: note.isOwner ? note.notebook : null, inbox: note.isOwner && note.inbox,
    excludedMemberIds: note.isOwner ? note.excludedMemberIds : [], archived: note.archived,
    source: note.source, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(),
    version: note.version, canEdit: note.canEdit, isOwner: note.isOwner, shared: note.shared,
    members: members.map((row) => ({ ashedMemberId: row.ashedMemberId, name: row.memberNameRaw, origin: row.origin === "detected" ? "detected" : "manual" })),
  };
}

async function noteDtos(actor: KnowledgeActor, notes: ReadableNote[]): Promise<PerformanceNoteDto[]> {
  if (!notes.length) return [];
  const members = await getDb().select({
    noteId: schema.performanceNoteMembers.noteId, ashedMemberId: schema.performanceNoteMembers.ashedMemberId,
    memberNameRaw: schema.performanceNoteMembers.memberNameRaw, origin: schema.performanceNoteMembers.origin,
  }).from(schema.performanceNoteMembers).where(and(eq(schema.performanceNoteMembers.allianceId, actor.allianceId), inArray(schema.performanceNoteMembers.noteId, notes.map((note) => note.id))));
  const byNote = new Map<string, typeof members>();
  for (const member of members) byNote.set(member.noteId, [...(byNote.get(member.noteId) ?? []), member]);
  return notes.map((note) => toDto(note, byNote.get(note.id) ?? [])).filter((note): note is PerformanceNoteDto => note !== null);
}

export async function listPerformanceNotes(actor: KnowledgeActor): Promise<PerformanceNoteDto[]> {
  const rows = await getDb().select(noteSelection(actor)).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, resourceJoin)
    .where(and(eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId)))
    .orderBy(desc(schema.performanceNotes.updatedAt), desc(schema.performanceNotes.id));
  return noteDtos(actor, rows.map(readableNote));
}

export async function getPerformanceNoteDto(input: { noteId: string; actor: KnowledgeActor }): Promise<PerformanceNoteDto | null> {
  const note = await getPerformanceNoteForAlliance(input);
  return note ? (await noteDtos(input.actor, [note]))[0] ?? null : null;
}

export async function listPerformanceNoteRoster(allianceId: string): Promise<PerformanceNoteRosterMember[]> {
  const rows = await getDb().select({ ashedMemberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName, previousNames: schema.allianceMembers.previousNamesJson })
    .from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.status, "active"))).orderBy(schema.allianceMembers.currentName);
  return rows.map((row) => ({ ...row, previousNames: row.previousNames ?? [] }));
}

export async function listPerformanceNotesForAshedMember(input: { actor: KnowledgeActor; ashedMemberId: string }): Promise<PerformanceNoteDto[]> {
  const rows = await getDb().select(noteSelection(input.actor)).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, resourceJoin)
    .innerJoin(schema.performanceNoteMembers, and(eq(schema.performanceNoteMembers.noteId, schema.performanceNotes.id), eq(schema.performanceNoteMembers.allianceId, input.actor.allianceId)))
    .where(and(eq(schema.performanceNotes.allianceId, input.actor.allianceId), eq(schema.performanceNoteMembers.ashedMemberId, input.ashedMemberId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId)))
    .orderBy(desc(schema.performanceNotes.createdAt));
  return noteDtos(input.actor, rows.map(readableNote));
}

export async function listNoteRevisions(actor: KnowledgeActor, noteId: string) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  const rows = await getDb().select().from(schema.knowledgeNoteRevisions)
    .where(and(eq(schema.knowledgeNoteRevisions.noteId, noteId), eq(schema.knowledgeNoteRevisions.allianceId, actor.allianceId)))
    .orderBy(desc(schema.knowledgeNoteRevisions.version)).limit(30);
  return rows.map((row) => ({ id: row.id, version: row.version, snapshot: row.snapshot, editedAt: row.editedAt.toISOString() }));
}
