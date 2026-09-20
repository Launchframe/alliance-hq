import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { escapeLikePrefix } from "@/lib/admin/audit-query";
import { knowledgeHash } from "@/lib/notes/mutations.server";
import { isPlaceholderOnlySearchQuery } from "@/lib/notes/search.shared";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { knowledgeActorOwnsResource, type KnowledgeAccess, type KnowledgeActor } from "@/lib/notes/policy.shared";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, touchKnowledgeResource, type KnowledgeTransaction } from "@/lib/notes/resources.server";
import { NOTE_LIST_PAGE_SIZE, noteListFilterSchema, noteTitle, noteExcerpt, type NoteFields, type NotePatch, type NoteListFilter, type NoteListCursor } from "@/lib/notes/workspace.shared";
import { redactIntakeText } from "@/lib/notes/intake.shared";
import { resourcePaging, resourcePage } from "@/lib/notes/pagination.server";
import { KNOWLEDGE_PAGE_SIZE } from "@/lib/notes/pagination.shared";
import type { PerformanceNoteDto, PerformanceNoteIntakeMode, PerformanceNoteKind, PerformanceNoteRosterMember, PerformanceNoteSummary, NotesListPage } from "./types.shared";

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

type CreatePerformanceNote = {
  actor: KnowledgeActor; kind: PerformanceNoteKind; intakeMode: PerformanceNoteIntakeMode; body: string;
  captureSource?: "web" | "discord"; captureDiscordUserId?: string | null;
} & Partial<Omit<NoteFields, "kind" | "body">>;

export async function createPerformanceNoteInTransaction(tx: KnowledgeTransaction, input: CreatePerformanceNote): Promise<string> {
  const id = nanoid();
  const resourceId = await createKnowledgeResource(tx, input.actor, "note", id);
  const now = new Date();
  await tx.insert(schema.performanceNotes).values({
    id, resourceId, allianceId: input.actor.allianceId,
    kind: input.kind, intakeMode: input.intakeMode, body: input.body,
    documentType: input.documentType ?? "note", keyDecisions: input.keyDecisions ?? [], openQuestions: input.openQuestions ?? [],
    title: input.title ?? "", priority: input.priority ?? null, priorityMode: input.priorityMode ?? "manual", labels: input.labels ?? [],
    notebook: input.notebook ?? null, journalDate: input.journalDate ?? null, inbox: input.inbox ?? true,
    excludedMemberIds: input.excludedMemberIds ?? [], source: input.captureSource ?? input.actor.kind,
    createdByDiscordUserId: input.captureDiscordUserId ?? input.actor.discordUserId, createdByHqUserId: input.actor.hqUserId,
    createdAt: now, updatedAt: now,
  });
  if (input.memberIds?.length) await setNoteMembers(tx, input.actor, id, input.memberIds, input.detectedMemberIds);
  return id;
}

export async function createPerformanceNote(input: CreatePerformanceNote): Promise<string> {
  return getDb().transaction((tx) => createPerformanceNoteInTransaction(tx, input));
}

export async function getPerformanceNoteForAlliance(input: { noteId: string; actor: KnowledgeActor; access?: KnowledgeAccess }) {
  const [row] = await getDb().select(noteSelection(input.actor)).from(schema.performanceNotes)
    .innerJoin(schema.knowledgeResources, resourceJoin)
    .where(and(eq(schema.performanceNotes.id, input.noteId), eq(schema.performanceNotes.allianceId, input.actor.allianceId), isNull(schema.performanceNotes.expungedAt), knowledgeAccessCondition(input.actor, schema.performanceNotes.resourceId, input.access))).limit(1);
  return row ? readableNote(row) : null;
}

export async function updatePerformanceNoteInTransaction(tx: KnowledgeTransaction, actor: KnowledgeActor, noteId: string, input: NotePatch) {
  const [existing] = await tx.select({ resourceId: schema.performanceNotes.resourceId }).from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, noteId), eq(schema.performanceNotes.allianceId, actor.allianceId), isNull(schema.performanceNotes.expungedAt)));
  if (!existing) throw new KnowledgeAccessError("not_found");
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
        intakeProvenance: note.intakeProvenance,
        title: note.title, body: note.body, kind: isNoteKind(note.kind) ? note.kind : "note",
        documentType: note.documentType, keyDecisions: note.keyDecisions, openQuestions: note.openQuestions,
        priority: note.priority, priorityMode: note.priorityMode, labels: note.labels, notebook: note.notebook, journalDate: note.journalDate,
        inbox: note.inbox, archived: resource.archivedAt !== null,
        memberIds: members.map((member) => member.ashedMemberId),
        detectedMemberIds: members.filter((member) => member.origin === "detected").map((member) => member.ashedMemberId),
        excludedMemberIds: note.excludedMemberIds,
      },
    });
    let exclusions = note.excludedMemberIds;
    if (knowledgeActorOwnsResource(actor, resource)) {
      exclusions = input.excludedMemberIds ?? note.excludedMemberIds;
      if (input.memberIds !== undefined) {
        const selected = new Set(input.memberIds);
        exclusions = [...new Set([...exclusions, ...members.filter((member) => !selected.has(member.ashedMemberId)).map((member) => member.ashedMemberId)])].filter((id) => !selected.has(id));
      }
    }
    if (input.memberIds !== undefined) await setNoteMembers(tx, actor, noteId, input.memberIds, input.detectedMemberIds);
    await tx.update(schema.performanceNotes).set({
      title: input.title, body: input.body, kind: input.kind, priority: input.priority, priorityMode: input.priorityMode ?? (input.priority !== undefined ? "manual" : undefined),
      labels: input.labels, notebook: input.notebook, journalDate: input.journalDate,
      documentType: input.documentType, keyDecisions: input.keyDecisions, openQuestions: input.openQuestions,
      inbox: input.inbox, excludedMemberIds: exclusions, updatedAt: new Date(),
    }).where(and(eq(schema.performanceNotes.id, noteId), eq(schema.performanceNotes.allianceId, actor.allianceId)));
    if (input.archived !== undefined) await tx.update(schema.knowledgeResources).set({ archivedAt: input.archived ? new Date() : null }).where(eq(schema.knowledgeResources.id, resource.id));
    await touchKnowledgeResource(tx, resource.id);
}

export async function updatePerformanceNote(actor: KnowledgeActor, noteId: string, input: NotePatch) {
  await getDb().transaction((tx) => updatePerformanceNoteInTransaction(tx, actor, noteId, input));
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
    id: note.id, kind: note.kind, intakeMode: note.intakeMode, body: redactIntakeText(note.body), title: redactIntakeText(note.title),
    documentType: note.documentType, keyDecisions: note.keyDecisions.map(redactIntakeText), openQuestions: note.openQuestions.map(redactIntakeText),
    priority: note.priority, priorityMode: note.priorityMode, labels: note.labels, journalDate: note.journalDate,
    intakeProvenance: note.isOwner ? note.intakeProvenance : undefined,
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
    .orderBy(desc(schema.performanceNotes.updatedAt), desc(schema.performanceNotes.id)).limit(NOTE_LIST_PAGE_SIZE);
  return noteDtos(actor, rows.map(readableNote));
}

function noteSummary(note: PerformanceNoteDto): PerformanceNoteSummary {
  return { id: note.id, kind: note.kind, title: noteTitle(note), excerpt: noteExcerpt(note.body), priority: note.priority, labels: note.labels,
    notebook: note.notebook, inbox: note.inbox, archived: note.archived, source: note.source, createdAt: note.createdAt, updatedAt: note.updatedAt,
    version: note.version, canEdit: note.canEdit, isOwner: note.isOwner, shared: note.shared, members: note.members };
}
export async function listPerformanceNotePage(actor: KnowledgeActor, raw: NoteListFilter, cursor: NoteListCursor | null = null): Promise<NotesListPage> {
  if (actor.kind !== "web" || !actor.hqUserId) throw new KnowledgeAccessError("forbidden");
  const filter = noteListFilterSchema.parse(raw);
  filter.q = redactIntakeText(filter.q); filter.label = redactIntakeText(filter.label);
  const scope = `${actor.allianceId}:${actor.hqUserId}`;
  const key = knowledgeHash([filter.view, filter.q, filter.notebook, filter.source, filter.priority, filter.sort, ...(filter.label || filter.member ? [filter.label, filter.member] : [])]);
  if (cursor && cursor.scope !== scope) throw new KnowledgeAccessError("forbidden");
  if (cursor && cursor.key !== key) throw new KnowledgeAccessError("invalid");
  const n = schema.performanceNotes, r = schema.knowledgeResources;
  const owned = knowledgeAccessCondition(actor, n.resourceId, "share");
  const readable = and(eq(n.allianceId, actor.allianceId), isNull(n.expungedAt), knowledgeAccessCondition(actor, n.resourceId));
  const inView = filter.view === "archived" ? sql`${owned} and ${r.archivedAt} is not null`
    : sql`${r.archivedAt} is null and ${filter.view === "shared" ? sql`not (${owned})` : filter.view === "inbox" ? sql`${owned} and ${n.inbox}` : owned}`;
  const rank = sql<number>`case ${n.priority} when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
  const text = sql`notes_search_text(notes_document_text(${n.title}, ${n.body}, ${n.keyDecisions}, ${n.openQuestions}) || ' ' || coalesce((select string_agg(label, ' ') from jsonb_array_elements_text(${n.labels}) labels(label)), '') || ' ' || coalesce((select string_agg(m.member_name_raw, ' ') from performance_note_members m where m.note_id = ${n.id} and m.alliance_id = ${actor.allianceId}), ''))`;
  const backwards = cursor?.direction === "previous", order = backwards ? asc : desc;
  const comparison = backwards ? sql`>` : sql`<`;
  const boundary = cursor ? filter.sort === "priority"
    ? sql`(${rank}, ${n.updatedAt}, ${n.id}) ${comparison} (${cursor.rank}, ${cursor.updatedAt}::text::timestamptz, ${cursor.id})`
    : sql`(${n.updatedAt}, ${n.id}) ${comparison} (${cursor.updatedAt}::text::timestamptz, ${cursor.id})` : undefined;
  const db = getDb();
  const [rows, totals] = await Promise.all([
    db.select({ ...noteSelection(actor), cursorTime: sql<string>`to_char(${n.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, rank }).from(n).innerJoin(r, resourceJoin)
      .where(and(readable, inView, filter.notebook ? and(owned, eq(n.notebook, filter.notebook)) : undefined,
        filter.label ? sql`${n.labels} ? ${filter.label}` : undefined,
        filter.member ? sql`exists(select 1 from performance_note_members m where m.note_id = ${n.id} and m.alliance_id = ${actor.allianceId} and m.ashed_member_id = ${filter.member})` : undefined,
        filter.source ? eq(n.source, filter.source) : undefined, filter.priority === "all" ? undefined : filter.priority === "none" ? isNull(n.priority) : eq(n.priority, filter.priority),
        filter.q ? isPlaceholderOnlySearchQuery(filter.q) ? sql`false` : sql`${text} ilike ${`%${escapeLikePrefix(filter.q)}%`} escape '\\'` : undefined, boundary))
      .orderBy(...(filter.sort === "priority" ? [order(rank)] : []), order(n.updatedAt), order(n.id)).limit(NOTE_LIST_PAGE_SIZE + 1),
    db.select({ notebook: sql<number>`count(*) filter (where ${owned} and ${r.archivedAt} is null)`, inbox: sql<number>`count(*) filter (where ${owned} and ${n.inbox} and ${r.archivedAt} is null)`,
      shared: sql<number>`count(*) filter (where not (${owned}) and ${r.archivedAt} is null)`, archived: sql<number>`count(*) filter (where ${owned} and ${r.archivedAt} is not null)`,
      notebooks: sql<string[] | null>`array_agg(distinct ${n.notebook}) filter (where ${owned} and ${r.archivedAt} is null and ${n.notebook} is not null)` }).from(n).innerJoin(r, resourceJoin).where(readable),
  ]);
  const page = rows.slice(0, NOTE_LIST_PAGE_SIZE), counts = totals[0];
  if (backwards) page.reverse();
  const makeCursor = (row: typeof rows[number] | undefined, direction: "next" | "previous") => row ? JSON.stringify({ version: 1, scope, key, id: row.note.id, updatedAt: row.cursorTime, rank: Number(row.rank), direction } satisfies NoteListCursor) : null;
  return { scope, filter, items: (await noteDtos(actor, page.map(readableNote))).map(noteSummary),
    counts: { notebook: Number(counts.notebook), inbox: Number(counts.inbox), shared: Number(counts.shared), archived: Number(counts.archived) }, notebooks: counts.notebooks ?? [],
    nextCursor: (backwards ? !!cursor : rows.length > NOTE_LIST_PAGE_SIZE) ? makeCursor(page.at(-1), "next") : null,
    previousCursor: (backwards ? rows.length > NOTE_LIST_PAGE_SIZE : !!cursor) ? makeCursor(page[0], "previous") : null };
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

function revisionDto(row: typeof schema.knowledgeNoteRevisions.$inferSelect) {
  return { id: row.id, version: row.version, snapshot: { ...row.snapshot, title: redactIntakeText(row.snapshot.title), body: redactIntakeText(row.snapshot.body), documentType: row.snapshot.documentType ?? "note", labels: (row.snapshot.labels ?? []).map(redactIntakeText), notebook: row.snapshot.notebook ? redactIntakeText(row.snapshot.notebook) : null, keyDecisions: (row.snapshot.keyDecisions ?? []).map(redactIntakeText), openQuestions: (row.snapshot.openQuestions ?? []).map(redactIntakeText) }, editedAt: row.editedAt.toISOString() };
}
export async function getNoteRevision(actor: KnowledgeActor, noteId: string, version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new KnowledgeAccessError("invalid");
  if (!await getPerformanceNoteForAlliance({ actor, noteId, access: "share" })) throw new KnowledgeAccessError("not_found");
  const revisions = schema.knowledgeNoteRevisions;
  const [row] = await getDb().select().from(revisions).where(and(eq(revisions.noteId, noteId), eq(revisions.allianceId, actor.allianceId), eq(revisions.version, version)));
  if (!row) throw new KnowledgeAccessError("not_found");
  return revisionDto(row);
}
export async function listNoteRevisionPage(actor: KnowledgeActor, noteId: string, cursor: string | null = null) {
  if (!await getPerformanceNoteForAlliance({ actor, noteId, access: "share" })) throw new KnowledgeAccessError("not_found");
  const page = resourcePaging(actor, ["note-revisions", noteId], cursor), revisions = schema.knowledgeNoteRevisions;
  if (page.cursor && typeof page.cursor.position !== "number") throw new KnowledgeAccessError("invalid");
  const rows = await getDb().select({ id: revisions.id, version: revisions.version, editedAt: revisions.editedAt }).from(revisions)
    .where(and(eq(revisions.noteId, noteId), eq(revisions.allianceId, actor.allianceId), page.cursor ? sql`${revisions.version} ${page.comparison} ${page.cursor.position}` : undefined))
    .orderBy(page.order(revisions.version)).limit(KNOWLEDGE_PAGE_SIZE + 1);
  return resourcePage(rows, page, (row) => ({ id: row.id, position: row.version }));
}
export async function listNoteRevisions(actor: KnowledgeActor, noteId: string) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  const rows = await getDb().select().from(schema.knowledgeNoteRevisions)
    .where(and(eq(schema.knowledgeNoteRevisions.noteId, noteId), eq(schema.knowledgeNoteRevisions.allianceId, actor.allianceId)))
    .orderBy(desc(schema.knowledgeNoteRevisions.version)).limit(30);
  return rows.map(revisionDto);
}
