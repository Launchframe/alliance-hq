import { z } from "zod";
import { PERFORMANCE_NOTE_KINDS } from "@/lib/performance-notes/types.shared";

export const NOTE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type NotePriority = (typeof NOTE_PRIORITIES)[number] | null;
export const NOTE_DOCUMENT_TYPES = ["note", "journal", "meeting", "reference"] as const;
export type NoteDocumentType = typeof NOTE_DOCUMENT_TYPES[number];
export type NoteWorkspaceView = "notebook" | "inbox" | "shared" | "archived" | "tasks" | "boards" | "drafts" | "imports" | "search" | "knowledge" | "studio" | "publications";

export const NOTE_LIST_PAGE_SIZE = 50;
export const NOTE_LIST_VIEWS = ["notebook", "inbox", "shared", "archived"] as const;
export const noteListFilterSchema = z.object({
  view: z.enum(NOTE_LIST_VIEWS).default("notebook"), q: z.string().trim().max(200).default(""),
  notebook: z.string().max(60).default(""), source: z.enum(["", "web", "discord"]).default(""),
  priority: z.enum(["all", "none", ...NOTE_PRIORITIES]).default("all"), sort: z.enum(["recent", "priority"]).default("recent"),
});
export type NoteListFilter = z.infer<typeof noteListFilterSchema>;
const noteListCursorSchema = z.object({ version: z.literal(1), scope: z.string().min(1).max(300), key: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().min(1).max(120), updatedAt: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")), rank: z.number().int().min(0).max(4) }).strict();
export type NoteListCursor = z.infer<typeof noteListCursorSchema>;
export function parseNoteListCursor(raw: string | null): NoteListCursor | null {
  return raw === null ? null : noteListCursorSchema.parse(JSON.parse(z.string().min(1).max(900).parse(raw)));
}
export function readNoteListFilter(params: URLSearchParams): NoteListFilter {
  const view = params.get("view");
  return noteListFilterSchema.parse({ ...Object.fromEntries(["q", "notebook", "source", "priority", "sort"].flatMap((key) => params.has(key) ? [[key, params.get(key)]] : [])), view: NOTE_LIST_VIEWS.includes(view as NoteListFilter["view"]) ? view : "notebook" });
}
export function noteListUrl(filter: NoteListFilter, cursor: string | null = null): string {
  const params = new URLSearchParams({ format: "summary", ...filter });
  if (cursor) params.set("cursor", cursor);
  return `/api/notes?${params}`;
}

export function normalizeNoteLabels(values: readonly string[]): string[] {
  const labels = new Map<string, string>();
  for (const value of values) {
    const label = value.trim();
    if (label && !labels.has(label.toLocaleLowerCase())) labels.set(label.toLocaleLowerCase(), label);
  }
  return [...labels.values()];
}

function isJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const memberIds = z.array(z.string().min(1).max(120)).max(100);
const noteValidators = {
  title: z.string().trim().max(160),
  body: z.string().trim().min(1).max(100_000),
  documentType: z.enum(NOTE_DOCUMENT_TYPES),
  keyDecisions: z.array(z.string().max(10_000)).max(100),
  openQuestions: z.array(z.string().max(10_000)).max(100),
  kind: z.enum(PERFORMANCE_NOTE_KINDS),
  priority: z.enum(NOTE_PRIORITIES).nullable(),
  priorityMode: z.enum(["manual", "auto"]),
  labels: z.array(z.string().trim().max(32)).max(12).transform(normalizeNoteLabels),
  notebook: z.string().trim().max(60).nullable().transform((value) => value || null),
  journalDate: z.string().refine(isJournalDate).nullable(),
  inbox: z.boolean(),
  memberIds, detectedMemberIds: memberIds, excludedMemberIds: memberIds,
};
export const noteFieldsSchema = z.object({
  ...noteValidators,
  title: noteValidators.title.default(""), kind: noteValidators.kind.default("note"),
  documentType: noteValidators.documentType.default("note"), keyDecisions: noteValidators.keyDecisions.default([]), openQuestions: noteValidators.openQuestions.default([]),
  priority: noteValidators.priority.default(null), priorityMode: noteValidators.priorityMode.default("manual"), labels: noteValidators.labels.default([]),
  notebook: noteValidators.notebook.default(null), journalDate: noteValidators.journalDate.default(null),
  inbox: noteValidators.inbox.default(true), memberIds: memberIds.default([]),
  detectedMemberIds: memberIds.default([]), excludedMemberIds: memberIds.default([]),
});

export const notePatchSchema = z.object(noteValidators).partial().extend({
  expectedVersion: z.number().int().positive(),
  archived: z.boolean().optional(),
});

export type NoteFields = z.output<typeof noteFieldsSchema>;
export type NotePatch = z.output<typeof notePatchSchema>;

export function notesWorkspaceLocation(pathname: string, search: string, changes: Record<string, string | null>): string {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) { if (value === null) params.delete(key); else params.set(key, value); }
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function noteRouteId(value: string): string {
  return value.replace(/^meeting%3a/i, "meeting:");
}

export function notePriorityRank(priority: NotePriority): number {
  return priority === null ? 0 : NOTE_PRIORITIES.indexOf(priority) + 1;
}

export function noteTitle(note: { title?: string; body: string }): string {
  return note.title?.trim() || note.body.split(/\r?\n/).find((line) => line.trim())?.trim().replace(/^#{1,6}\s+/, "").slice(0, 120) || "";
}

export function noteExcerpt(body: string): string {
  return body.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
}
