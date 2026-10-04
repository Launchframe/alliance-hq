import { z } from "zod";
import { taskCreateSchema, TASK_STATUSES, summarizeNoteTask, type NoteTask, type NoteTaskSummary } from "./tasks.shared";
import type { NoteShareState } from "./sharing.shared";

export const boardCreateSchema = z.object({ name: z.string().trim().min(1).max(100), requestId: z.string().min(8).max(120) });
const version = z.number().int().positive();
const id = z.string().min(1).max(120);
const base = { expectedVersion: version, requestId: z.string().min(8).max(120) };
const taskBase = { ...base, taskId: id, expectedTaskVersion: version };
export const boardCommandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("rename"), name: boardCreateSchema.shape.name }),
  z.object({ ...taskBase, kind: z.literal("share") }),
  z.object({ ...taskBase, kind: z.literal("remove") }),
  z.object({ ...taskBase, kind: z.literal("move"), status: z.enum(TASK_STATUSES), beforeTaskId: id.nullable().default(null) }),
  z.object({ ...base, kind: z.literal("create"), task: taskCreateSchema.omit({ sourceNoteId: true, requestId: true }) }),
]);
export type NoteBoardCommand = z.output<typeof boardCommandSchema>;
export type NoteBoardSummary = { id: string; name: string; version: number };
export type NoteBoardSnapshot = NoteBoardSummary & {
  allianceId: string; principalId: string; canWrite: boolean;
  tasks: Array<NoteTask & { position: number; teamId: string | null }>;
  people: NoteShareState["recipients"]; teams: Array<{ id: string; name: string }>;
};
export type NoteBoardViewSnapshot = Omit<NoteBoardSnapshot, "tasks"> & { tasks: Array<NoteTaskSummary & { position: number; teamId: string | null }> };
export function summarizeNoteBoard(snapshot: NoteBoardSnapshot): NoteBoardViewSnapshot {
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...summarizeNoteTask(task), position: task.position, teamId: task.teamId })) };
}
export function orderBoardTasks(ids: string[], movedId: string, beforeId: string | null): string[] {
  if (beforeId === movedId) return ids;
  const result = ids.filter((id) => id !== movedId);
  const index = beforeId ? result.indexOf(beforeId) : result.length;
  if (index < 0) throw new Error("invalid");
  result.splice(index, 0, movedId);
  return result;
}
