import { z } from "zod";
import { PERFORMANCE_NOTE_KINDS } from "@/lib/performance-notes/types.shared";

export const NOTE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type NotePriority = (typeof NOTE_PRIORITIES)[number] | null;
export const NOTE_DOCUMENT_TYPES = ["note", "journal", "meeting", "reference"] as const;
export type NoteDocumentType = typeof NOTE_DOCUMENT_TYPES[number];
export const NOTE_WORKSPACE_VIEWS = ["notebook", "inbox", "shared", "archived", "tasks", "boards", "drafts", "imports", "search", "knowledge", "studio", "publications"] as const;
export type NoteWorkspaceView = typeof NOTE_WORKSPACE_VIEWS[number];

export const NOTE_LIST_PAGE_SIZE = 50;
export const NOTE_LIST_VIEWS = ["notebook", "inbox", "shared", "archived"] as const;
export const noteListFilterSchema = z.object({
  view: z.enum(NOTE_LIST_VIEWS).default("notebook"), q: z.string().trim().max(200).default(""),
  notebook: z.string().max(60).default(""), source: z.enum(["", "web", "discord"]).default(""),
  priority: z.enum(["all", "none", ...NOTE_PRIORITIES]).default("all"), sort: z.enum(["recent", "priority"]).default("recent"),
});
export type NoteListFilter = z.infer<typeof noteListFilterSchema>;
export const noteWorkspaceStateSchema = noteListFilterSchema.extend({
  view: z.enum(NOTE_WORKSPACE_VIEWS).default("notebook"), q: z.string().max(200).default(""), layout: z.enum(["cards", "list"]).default("cards"),
  boardGroup: z.enum(["none", "assignee", "team"]).default("none"), boardLayout: z.enum(["board", "list"]).default("board"), boardClosed: z.boolean().default(false),
  taskFilter: z.enum(["active", "all", "archived", "open", "in_progress", "done", "cancelled"]).default("active"),
  searchQuery: z.string().max(200).default(""), searchKind: z.enum(["all", "note", "task", "source"]).default("all"),
  knowledgeOwned: z.boolean().default(true), knowledgeQuery: z.string().max(200).default(""), knowledgeSources: z.boolean().default(false),
  studioKind: z.enum(["synthesize", "localize", "ask", "insight"]).default("synthesize"), studioSources: z.boolean().default(false),
  publicationQuery: z.string().max(200).default(""),
}).strict();
export type NoteWorkspaceState = z.infer<typeof noteWorkspaceStateSchema>;
export type WorkspacePreferences = { scope: string; version: number; state: NoteWorkspaceState };
export const workspacePreferenceWriteSchema = z.object({ expectedScope: z.string().min(1).max(300), expectedVersion: z.number().int().nonnegative(), state: noteWorkspaceStateSchema }).strict();
export function readWorkspaceState(params: URLSearchParams, saved: NoteWorkspaceState, scope: string): NoteWorkspaceState {
  if (params.has("workspaceScope") && params.get("workspaceScope") !== scope) return { ...saved };
  return noteWorkspaceStateSchema.parse({ ...saved, ...Object.fromEntries(Object.keys(saved).flatMap((key) => params.has(key) ? [[key, typeof saved[key as keyof NoteWorkspaceState] === "boolean" ? params.get(key) === "1" : params.get(key)]] : [])) });
}
export function noteFilterFromWorkspace(state: Pick<NoteWorkspaceState, "view" | "q" | "notebook" | "source" | "priority" | "sort">): NoteListFilter {
  return noteListFilterSchema.parse({ ...state, view: NOTE_LIST_VIEWS.includes(state.view as NoteListFilter["view"]) ? state.view : "notebook" });
}
export function workspaceOffset(raw: string | null, step: number): number {
  const value = Number(raw ?? 0);
  return Number.isSafeInteger(value) && value >= 0 && value <= 100_000 && value % step === 0 ? value : 0;
}
export function scopedWorkspaceLocation(location: string, saved: NoteWorkspaceState, scope: string): string {
  const url = new URL(location, "https://notes.invalid");
  if (!/^\/(?:(?:en-US|pt-BR)\/)?notes(?:\/|$)/.test(url.pathname)) return `${url.pathname}${url.search}${url.hash}`;
  const foreign = url.searchParams.has("workspaceScope") && url.searchParams.get("workspaceScope") !== scope;
  const reset = foreign ? Object.fromEntries(["cursor", "importCursor", "taskCursor", "reviewCursor", "knowledgeOffset", "searchOffset", "searchRun", "messageOffset", "publicationCursor"].map((key) => [key, null])) : {};
  return workspaceStateLocation(url.pathname, url.search, readWorkspaceState(url.searchParams, saved, scope), scope, reset) + url.hash;
}
export function notesFocusKey(pathname: string, params: URLSearchParams): string {
  const draft = params.get("draft");
  if (draft) return `draft:${draft}`;
  const id = params.get("note") ?? pathname.match(/\/notes\/([^/]+)$/)?.[1];
  return id ? `note:${noteRouteId(id)}` : "";
}
export function workspaceStateLocation(pathname: string, search: string, state: NoteWorkspaceState, scope: string, changes: Record<string, string | null> = {}): string {
  return notesWorkspaceLocation(pathname, search, { ...Object.fromEntries(Object.entries(state).map(([key, value]) => [key, typeof value === "boolean" ? value ? "1" : "0" : value])), workspaceScope: scope, ...changes });
}
const noteListCursorSchema = z.object({ version: z.literal(1), scope: z.string().min(1).max(300), key: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().min(1).max(120), updatedAt: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")), rank: z.number().int().min(0).max(4), direction: z.enum(["next", "previous"]).optional() }).strict();
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
