import { z } from "zod";
import { captureTaskSchema, type IntakeResult } from "./intake.shared";
import { noteFieldsSchema, notePatchSchema } from "./workspace.shared";

export const ACTION_FIELDS = ["title", "description", "status", "priority", "included"] as const;
export const actionModesSchema = z.object({ title: z.enum(["auto", "manual"]), description: z.enum(["auto", "manual"]), status: z.enum(["auto", "manual"]), priority: z.enum(["auto", "manual"]), included: z.enum(["auto", "manual"]) });
export const automaticActionModes = (): z.infer<typeof actionModesSchema> => ({ title: "auto", description: "auto", status: "auto", priority: "auto", included: "auto" });
export const draftActionSchema = captureTaskSchema.extend({ modes: actionModesSchema.default(automaticActionModes), analysisId: z.string().max(120).nullable().default(null) });
export const draftStateSchema = z.object({
  fields: noteFieldsSchema.extend({ body: z.string().max(100_000), documentType: notePatchSchema.shape.documentType, keyDecisions: notePatchSchema.shape.keyDecisions, openQuestions: notePatchSchema.shape.openQuestions }),
  revision: z.number().int().nonnegative().default(0), overrideRevision: z.number().int().nonnegative().default(0),
  analysisRevision: z.number().int().default(-1), analysisId: z.string().max(120).nullable().default(null),
  tasks: z.array(draftActionSchema).max(10).default([]), aiEnabled: z.boolean().default(true), archive: z.boolean().nullable().default(null),
});
export const draftSaveSchema = z.object({
  expectedVersion: z.number().int().nonnegative(), state: draftStateSchema,
  sourceNoteId: z.string().min(1).max(120).nullable().default(null), sourceVersion: z.number().int().positive().nullable().default(null),
});
export type CaptureDraftState = z.output<typeof draftStateSchema>;
export type DraftAction = CaptureDraftState["tasks"][number];
export type CaptureDraft = { id: string; source: "web" | "discord"; sourceNoteId: string | null; sourceVersion: number | null; version: number; state: CaptureDraftState | null; status: "open" | "committed"; noteId: string | null; updatedAt: string };
export type CaptureProvenance = { draftId: string; draftVersion: number; inputHash: string; analysisId: string | null; interpreter: string | null; evidence: string | null; modes: Record<string, "auto" | "manual"> };

export function updateDraftAction(task: DraftAction, patch: Partial<Pick<DraftAction, typeof ACTION_FIELDS[number]>>): DraftAction {
  return { ...task, ...patch, modes: { ...task.modes, ...Object.fromEntries(Object.keys(patch).map((key) => [key, "manual"])) } };
}
export function editDraftAction(state: CaptureDraftState, actionKey: string, patch: Parameters<typeof updateDraftAction>[1]): CaptureDraftState {
  return { ...state, overrideRevision: state.overrideRevision + 1, tasks: state.tasks.map((task) => task.actionKey === actionKey ? updateDraftAction(task, patch) : task) };
}
export function mergeDraftActions(current: DraftAction[], result: IntakeResult): DraftAction[] {
  const tasks = result.actions.map((action) => {
    const previous = current.find((task) => task.actionKey === action.actionKey);
    const next = draftActionSchema.parse({ ...action, analysisId: result.analysisId ?? null });
    return previous ? { ...next, modes: previous.modes, ...Object.fromEntries(ACTION_FIELDS.filter((key) => previous.modes[key] === "manual").map((key) => [key, previous[key]])) } : next;
  });
  return [...tasks, ...current.filter((task) => ACTION_FIELDS.some((key) => task.modes[key] === "manual") && !tasks.some((next) => next.actionKey === task.actionKey))].slice(0, 10);
}
export function applyDraftInterpretation(state: CaptureDraftState, result: IntakeResult): CaptureDraftState {
  if (!state.aiEnabled || state.revision !== result.revision || state.overrideRevision !== result.overrideRevision) return state;
  return { ...state, fields: state.fields.priorityMode === "manual" ? state.fields : { ...state.fields, priority: result.priority }, analysisRevision: result.revision, analysisId: result.analysisId ?? null, tasks: mergeDraftActions(state.tasks, result) };
}
export function draftActionIsCurrent(task: DraftAction, state: Pick<CaptureDraftState, "revision" | "analysisRevision" | "aiEnabled">): boolean {
  return state.analysisRevision === state.revision && state.aiEnabled || ACTION_FIELDS.some((key) => task.modes[key] === "manual");
}
export function reviewedDraftTasks(state: CaptureDraftState): DraftAction[] {
  return state.tasks.filter((task) => task.included && draftActionIsCurrent(task, state));
}
