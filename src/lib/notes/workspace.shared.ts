import { z } from "zod";
import { PERFORMANCE_NOTE_KINDS } from "@/lib/performance-notes/types.shared";

export const NOTE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type NotePriority = (typeof NOTE_PRIORITIES)[number] | null;
export type NoteWorkspaceView = "notebook" | "inbox" | "shared" | "archived";

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
  kind: z.enum(PERFORMANCE_NOTE_KINDS),
  priority: z.enum(NOTE_PRIORITIES).nullable(),
  labels: z.array(z.string().trim().max(32)).max(12).transform(normalizeNoteLabels),
  notebook: z.string().trim().max(60).nullable().transform((value) => value || null),
  journalDate: z.string().refine(isJournalDate).nullable(),
  inbox: z.boolean(),
  memberIds, detectedMemberIds: memberIds, excludedMemberIds: memberIds,
};
export const noteFieldsSchema = z.object({
  ...noteValidators,
  title: noteValidators.title.default(""), kind: noteValidators.kind.default("note"),
  priority: noteValidators.priority.default(null), labels: noteValidators.labels.default([]),
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

export function notePriorityRank(priority: NotePriority): number {
  return priority === null ? 0 : NOTE_PRIORITIES.indexOf(priority) + 1;
}

export function noteTitle(note: { title?: string; body: string }): string {
  return note.title?.trim() || note.body.split(/\r?\n/).find((line) => line.trim())?.trim().replace(/^#{1,6}\s+/, "").slice(0, 120) || "";
}

export function noteExcerpt(body: string): string {
  return body.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
}
