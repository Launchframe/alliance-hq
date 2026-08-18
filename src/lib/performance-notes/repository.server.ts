import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
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
  allianceId: string;
  kind: PerformanceNoteKind;
  intakeMode: PerformanceNoteIntakeMode;
  body: string;
  source: "discord" | "web";
  createdByDiscordUserId?: string | null;
  createdByHqUserId?: string | null;
}): Promise<string> {
  const db = getDb();
  const id = nanoid();
  const now = new Date();
  await db.insert(schema.performanceNotes).values({
    id,
    allianceId: input.allianceId,
    kind: input.kind,
    intakeMode: input.intakeMode,
    body: input.body,
    source: input.source,
    createdByDiscordUserId: input.createdByDiscordUserId ?? null,
    createdByHqUserId: input.createdByHqUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getPerformanceNoteForAlliance(input: {
  noteId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.performanceNotes)
    .where(
      and(
        eq(schema.performanceNotes.id, input.noteId),
        eq(schema.performanceNotes.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function resolveLocalMembers(
  allianceId: string,
  ashedMemberIds: string[],
): Promise<Map<string, { id: string; currentName: string }>> {
  if (ashedMemberIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({
      id: schema.allianceMembers.id,
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        inArray(schema.allianceMembers.ashedMemberId, ashedMemberIds),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.ashedMemberId,
      { id: row.id, currentName: row.currentName },
    ]),
  );
}

export async function attachMembersToPerformanceNote(input: {
  allianceId: string;
  noteId: string;
  members: Array<{ ashedMemberId: string; memberNameRaw: string }>;
}): Promise<number> {
  if (input.members.length === 0) return 0;
  const note = await getPerformanceNoteForAlliance({
    noteId: input.noteId,
    allianceId: input.allianceId,
  });
  if (!note) return 0;

  const unique = new Map<string, string>();
  for (const member of input.members) {
    const ashedMemberId = member.ashedMemberId.trim();
    const nameRaw = member.memberNameRaw.trim();
    if (!ashedMemberId || !nameRaw) continue;
    unique.set(ashedMemberId, nameRaw);
  }
  if (unique.size === 0) return 0;

  const local = await resolveLocalMembers(input.allianceId, [...unique.keys()]);
  const db = getDb();
  const now = new Date();
  const values = [...unique.entries()].map(([ashedMemberId, memberNameRaw]) => ({
    id: nanoid(),
    noteId: input.noteId,
    allianceId: input.allianceId,
    allianceMemberId: local.get(ashedMemberId)?.id ?? null,
    ashedMemberId,
    memberNameRaw,
    createdAt: now,
  }));

  const inserted = await db
    .insert(schema.performanceNoteMembers)
    .values(values)
    .onConflictDoNothing({
      target: [
        schema.performanceNoteMembers.noteId,
        schema.performanceNoteMembers.ashedMemberId,
      ],
    })
    .returning({ id: schema.performanceNoteMembers.id });

  await db
    .update(schema.performanceNotes)
    .set({ updatedAt: now })
    .where(eq(schema.performanceNotes.id, input.noteId));

  return inserted.length;
}

function toDto(
  note: typeof schema.performanceNotes.$inferSelect,
  members: Array<{ ashedMemberId: string; memberNameRaw: string }>,
): PerformanceNoteDto | null {
  if (!isNoteKind(note.kind) || !isIntakeMode(note.intakeMode)) return null;
  const source = note.source === "web" ? "web" : "discord";
  return {
    id: note.id,
    kind: note.kind,
    intakeMode: note.intakeMode,
    body: note.body,
    source,
    createdAt: note.createdAt.toISOString(),
    members: members.map((row) => ({
      ashedMemberId: row.ashedMemberId,
      name: row.memberNameRaw,
    })),
  };
}

export async function listPerformanceNotes(
  allianceId: string,
): Promise<PerformanceNoteDto[]> {
  const db = getDb();
  const notes = await db
    .select()
    .from(schema.performanceNotes)
    .where(eq(schema.performanceNotes.allianceId, allianceId))
    .orderBy(desc(schema.performanceNotes.createdAt));
  if (notes.length === 0) return [];

  const memberRows = await db
    .select({
      noteId: schema.performanceNoteMembers.noteId,
      ashedMemberId: schema.performanceNoteMembers.ashedMemberId,
      memberNameRaw: schema.performanceNoteMembers.memberNameRaw,
    })
    .from(schema.performanceNoteMembers)
    .where(
      inArray(
        schema.performanceNoteMembers.noteId,
        notes.map((note) => note.id),
      ),
    );

  const byNote = new Map<string, Array<{ ashedMemberId: string; memberNameRaw: string }>>();
  for (const row of memberRows) {
    const list = byNote.get(row.noteId) ?? [];
    list.push({
      ashedMemberId: row.ashedMemberId,
      memberNameRaw: row.memberNameRaw,
    });
    byNote.set(row.noteId, list);
  }

  return notes
    .map((note) => toDto(note, byNote.get(note.id) ?? []))
    .filter((row): row is PerformanceNoteDto => row != null);
}

export async function getPerformanceNoteDto(input: {
  noteId: string;
  allianceId: string;
}): Promise<PerformanceNoteDto | null> {
  const note = await getPerformanceNoteForAlliance(input);
  if (!note) return null;
  const db = getDb();
  const memberRows = await db
    .select({
      ashedMemberId: schema.performanceNoteMembers.ashedMemberId,
      memberNameRaw: schema.performanceNoteMembers.memberNameRaw,
    })
    .from(schema.performanceNoteMembers)
    .where(eq(schema.performanceNoteMembers.noteId, note.id));
  return toDto(note, memberRows);
}

export async function listPerformanceNoteRoster(
  allianceId: string,
): Promise<PerformanceNoteRosterMember[]> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      name: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.status, "active"),
      ),
    )
    .orderBy(schema.allianceMembers.currentName);
  return rows;
}

export async function listPerformanceNotesForAshedMember(input: {
  allianceId: string;
  ashedMemberId: string;
}): Promise<PerformanceNoteDto[]> {
  const db = getDb();
  const links = await db
    .select({ noteId: schema.performanceNoteMembers.noteId })
    .from(schema.performanceNoteMembers)
    .where(
      and(
        eq(schema.performanceNoteMembers.allianceId, input.allianceId),
        eq(schema.performanceNoteMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
  if (links.length === 0) return [];
  const notes = await db
    .select()
    .from(schema.performanceNotes)
    .where(
      and(
        eq(schema.performanceNotes.allianceId, input.allianceId),
        inArray(
          schema.performanceNotes.id,
          links.map((row) => row.noteId),
        ),
      ),
    )
    .orderBy(desc(schema.performanceNotes.createdAt));
  const memberRows = await db
    .select({
      noteId: schema.performanceNoteMembers.noteId,
      ashedMemberId: schema.performanceNoteMembers.ashedMemberId,
      memberNameRaw: schema.performanceNoteMembers.memberNameRaw,
    })
    .from(schema.performanceNoteMembers)
    .where(
      inArray(
        schema.performanceNoteMembers.noteId,
        notes.map((note) => note.id),
      ),
    );
  const byNote = new Map<string, Array<{ ashedMemberId: string; memberNameRaw: string }>>();
  for (const row of memberRows) {
    const list = byNote.get(row.noteId) ?? [];
    list.push({
      ashedMemberId: row.ashedMemberId,
      memberNameRaw: row.memberNameRaw,
    });
    byNote.set(row.noteId, list);
  }
  return notes
    .map((note) => toDto(note, byNote.get(note.id) ?? []))
    .filter((row): row is PerformanceNoteDto => row != null);
}
