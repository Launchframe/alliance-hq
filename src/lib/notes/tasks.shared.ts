import { z } from "zod";
import type { CaptureProvenance } from "./drafts.shared";
import { NOTE_PRIORITIES, normalizeNoteLabels, type NotePriority } from "./workspace.shared";

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskListFilterSchema = z.object({
  status: z.enum(["active", "all", "archived", ...TASK_STATUSES]).default("active"), label: z.string().max(32).default(""),
  sourceNoteId: z.string().min(1).max(120).nullable().default(null), personalOnly: z.boolean().default(false),
});
export type TaskListFilter = z.infer<typeof taskListFilterSchema>;
export const normalizeTaskPriority = (priority: NotePriority | "normal"): NotePriority => priority === "normal" ? "medium" : priority;
export const taskPrioritySchema = z.enum([...NOTE_PRIORITIES, "normal"]).nullable().transform(normalizeTaskPriority);
const taskValidators = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(8_000).nullable(),
  status: z.enum(TASK_STATUSES),
  priority: taskPrioritySchema,
  labels: z.array(z.string().trim().max(32)).max(12).transform(normalizeNoteLabels),
  assigneeHqUserId: z.string().min(1).max(120).nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
};
export const taskCreateSchema = z.object({
  ...taskValidators,
  description: taskValidators.description.default(null),
  status: taskValidators.status.default("open"), priority: taskValidators.priority.default(null),
  labels: taskValidators.labels.default([]), assigneeHqUserId: taskValidators.assigneeHqUserId.default(null),
  dueAt: taskValidators.dueAt.default(null), sourceNoteId: z.string().min(1).max(120).nullable().default(null),
  shareWithAssignee: z.boolean().default(false), requestId: z.string().min(8).max(120).optional(),
});
export const taskPatchSchema = z.object(taskValidators).partial().extend({
  expectedVersion: z.number().int().positive(), archived: z.boolean().optional(),
  shareWithAssignee: z.boolean().optional(), requestId: z.string().min(8).max(120).optional(),
});
export type TaskCreate = z.output<typeof taskCreateSchema>;
export type TaskPatch = z.output<typeof taskPatchSchema>;
export type NoteTask = {
  intakeProvenance?: CaptureProvenance | null;
  id: string; title: string; description: string | null; status: TaskStatus; priority: NotePriority;
  labels: string[]; dueAt: string | null; completedAt: string | null;
  assignee: { id: string; name: string | null } | null; legacyAssigneeName: string | null;
  source: { id: string; title: string; channel: "web" | "discord" } | null;
  version: number; isOwner: boolean; canEdit: boolean; shared: boolean; archived: boolean;
  createdAt: string; updatedAt: string;
};
export type NoteTaskSummary = Omit<NoteTask, "description" | "intakeProvenance"> & { excerpt: string };
export function taskCompletedAt(status: TaskStatus, previous: Date | null, now: Date): Date | null {
  return status === "done" || status === "cancelled" ? previous ?? now : null;
}
