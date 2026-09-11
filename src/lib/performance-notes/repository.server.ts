import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { KnowledgeAccess, KnowledgeActor } from "@/lib/notes/policy.shared";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource } from "@/lib/notes/resources.server";
import type {
  PerformanceNoteDto,
  PerformanceNoteIntakeMode,
  PerformanceNoteKind,
  PerformanceNoteRosterMember,
} from "@/lib/performance-notes/types.shared";

function isNoteKind(value: string): value is PerformanceNoteKind {
  return value === "commendation" || value === "violation" || value === "note";
}

function isIntakeMode(value: string): value is PerformanceNoteIntakeMode {
  return value === "batch" || value === "thought";
}

export async function createPerformanceNote(input: {
  actor: KnowledgeActor;
  kind: PerformanceNoteKind;
  intakeMode: PerformanceNoteIntakeMode;
  body: string;
}): Promise<string> {
  return getDb().transaction(async (tx) => {
    const id = nanoid();
    const resourceId = await createKnowledgeResource(tx, input.actor, "note", id);
    const now = new Date();
    await tx.insert(schema.performanceNotes).values({
      id, resourceId, allianceId: input.actor.allianceId,
      kind: input.kind, intakeMode: input.intakeMode, body: input.body,
      source: input.actor.kind,
      createdByDiscordUserId: input.actor.discordUserId,
      createdByHqUserId: input.actor.hqUserId,
      createdAt: now, updatedAt: now,
    });
    return id;
  });
}

export async function getPerformanceNoteForAlliance(input: {
  noteId: string;
  actor: KnowledgeActor;
  access?: KnowledgeAccess;
}) {
  const [row] = await getDb().select({
    note: schema.performanceNotes,
    version: schema.knowledgeResources.version,
    canEdit: knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId, "edit"),
  }).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, schema.performanceNotes.resourceId), eq(schema.knowledgeResources.kind, "note"), eq(schema.knowledgeResources.entityId, schema.performanceNotes.id)))
    .where(and(
      eq(schema.performanceNotes.id, input.noteId),
      eq(schema.performanceNotes.allianceId, input.actor.allianceId),
      isNull(schema.performanceNotes.expungedAt),
      knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId, input.access),
    )).limit(1);
  return row ? { ...row.note, version: row.version, canEdit: row.canEdit === true } : null;
}

export async function attachMembersToPerformanceNote(input: {
  actor: KnowledgeActor;
  noteId: string;
  members: Array<{ ashedMemberId: string; memberNameRaw: string }>;
}): Promise<number> {
  const note = await getPerformanceNoteForAlliance({ noteId: input.noteId, actor: input.actor, access: "edit" });
  if (!note?.resourceId) throw new KnowledgeAccessError("not_found");
  const unique = new Map(input.members.map((member) => [member.ashedMemberId.trim(), member.memberNameRaw.trim()] as const).filter(([id, name]) => id && name));
  if (!unique.size) return 0;
  return getDb().transaction(async (tx) => {
    await lockKnowledgeResource(tx, input.actor, note.resourceId!);
    const [current] = await tx.select({ id: schema.performanceNotes.id }).from(schema.performanceNotes)
      .where(and(eq(schema.performanceNotes.id, input.noteId), eq(schema.performanceNotes.allianceId, input.actor.allianceId), eq(schema.performanceNotes.resourceId, note.resourceId!), isNull(schema.performanceNotes.expungedAt))).for("update");
    if (!current) throw new KnowledgeAccessError("not_found");
    const local = await tx.select({ id: schema.allianceMembers.id, memberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
      .from(schema.allianceMembers).where(and(eq(schema.allianceMembers.allianceId, input.actor.allianceId), inArray(schema.allianceMembers.ashedMemberId, [...unique.keys()])));
    const localById = new Map(local.map((member) => [member.memberId, member]));
    const now = new Date();
    const rows = [...unique.entries()].map(([ashedMemberId, raw]) => ({
      id: nanoid(), noteId: input.noteId, allianceId: input.actor.allianceId,
      allianceMemberId: localById.get(ashedMemberId)?.id ?? null,
      ashedMemberId, memberNameRaw: localById.get(ashedMemberId)?.name ?? raw, createdAt: now,
    }));
    const inserted = await tx.insert(schema.performanceNoteMembers).values(rows)
      .onConflictDoNothing({ target: [schema.performanceNoteMembers.noteId, schema.performanceNoteMembers.ashedMemberId] })
      .returning({ id: schema.performanceNoteMembers.id });
    if (inserted.length) {
      await tx.update(schema.performanceNotes).set({ updatedAt: now }).where(eq(schema.performanceNotes.id, input.noteId));
      await touchKnowledgeResource(tx, note.resourceId!);
    }
    return inserted.length;
  });
}

type ReadableNote = typeof schema.performanceNotes.$inferSelect & { version: number; canEdit: boolean };

function toDto(note: ReadableNote, members: Array<{ ashedMemberId: string; memberNameRaw: string }>): PerformanceNoteDto | null {
  if (!isNoteKind(note.kind) || !isIntakeMode(note.intakeMode) || (note.source !== "web" && note.source !== "discord")) return null;
  return {
    id: note.id, kind: note.kind, intakeMode: note.intakeMode, body: note.body,
    source: note.source, createdAt: note.createdAt.toISOString(), version: note.version, canEdit: note.canEdit,
    members: members.map((row) => ({ ashedMemberId: row.ashedMemberId, name: row.memberNameRaw })),
  };
}

async function noteDtos(actor: KnowledgeActor, notes: ReadableNote[]): Promise<PerformanceNoteDto[]> {
  if (!notes.length) return [];
  const members = await getDb().select({
    noteId: schema.performanceNoteMembers.noteId,
    ashedMemberId: schema.performanceNoteMembers.ashedMemberId,
    memberNameRaw: schema.performanceNoteMembers.memberNameRaw,
  }).from(schema.performanceNoteMembers).where(and(
    eq(schema.performanceNoteMembers.allianceId, actor.allianceId),
    inArray(schema.performanceNoteMembers.noteId, notes.map((note) => note.id)),
  ));
  const byNote = new Map<string, typeof members>();
  for (const member of members) byNote.set(member.noteId, [...(byNote.get(member.noteId) ?? []), member]);
  return notes.map((note) => toDto(note, byNote.get(note.id) ?? [])).filter((note): note is PerformanceNoteDto => note !== null);
}

export async function listPerformanceNotes(actor: KnowledgeActor): Promise<PerformanceNoteDto[]> {
  const rows = await getDb().select({
    note: schema.performanceNotes, version: schema.knowledgeResources.version,
    canEdit: knowledgeAccessCondition(actor, schema.performanceNotes.resourceId, "edit"),
  }).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, schema.performanceNotes.resourceId), eq(schema.knowledgeResources.kind, "note"), eq(schema.knowledgeResources.entityId, schema.performanceNotes.id)))
    .where(and(eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(actor, schema.performanceNotes.resourceId)))
    .orderBy(desc(schema.performanceNotes.createdAt));
  return noteDtos(actor, rows.map((row) => ({ ...row.note, version: row.version, canEdit: row.canEdit === true })));
}

export async function getPerformanceNoteDto(input: { noteId: string; actor: KnowledgeActor }): Promise<PerformanceNoteDto | null> {
  const note = await getPerformanceNoteForAlliance(input);
  return note ? (await noteDtos(input.actor, [note]))[0] ?? null : null;
}

export async function listPerformanceNoteRoster(allianceId: string): Promise<PerformanceNoteRosterMember[]> {
  return getDb().select({ ashedMemberId: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(and(eq(schema.allianceMembers.allianceId, allianceId), eq(schema.allianceMembers.status, "active")))
    .orderBy(schema.allianceMembers.currentName);
}

export async function listPerformanceNotesForAshedMember(input: { actor: KnowledgeActor; ashedMemberId: string }): Promise<PerformanceNoteDto[]> {
  const rows = await getDb().select({
    note: schema.performanceNotes, version: schema.knowledgeResources.version,
    canEdit: knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId, "edit"),
  }).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, and(eq(schema.knowledgeResources.id, schema.performanceNotes.resourceId), eq(schema.knowledgeResources.kind, "note"), eq(schema.knowledgeResources.entityId, schema.performanceNotes.id)))
    .innerJoin(schema.performanceNoteMembers, and(eq(schema.performanceNoteMembers.noteId, schema.performanceNotes.id), eq(schema.performanceNoteMembers.allianceId, input.actor.allianceId)))
    .where(and(
      eq(schema.performanceNotes.allianceId, input.actor.allianceId),
      eq(schema.performanceNoteMembers.ashedMemberId, input.ashedMemberId),
      isNull(schema.performanceNotes.expungedAt),
      knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId),
    )).orderBy(desc(schema.performanceNotes.createdAt));
  return noteDtos(input.actor, rows.map((row) => ({ ...row.note, version: row.version, canEdit: row.canEdit === true })));
}
