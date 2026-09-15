import { z } from "zod";
import { sanitizeBugReportConsoleText } from "@/lib/feedback/bug-report-log-sanitize";
import { noteFieldsSchema, NOTE_PRIORITIES, type NotePriority } from "./workspace.shared";
import { taskCreateSchema, TASK_STATUSES } from "./tasks.shared";

export const intakeRequestSchema = z.object({
  draftId: z.string().min(8).max(120), revision: z.number().int().nonnegative(),
  overrideRevision: z.number().int().nonnegative(), body: z.string().trim().min(1).max(10_000),
  locale: z.enum(["en-US", "pt-BR"]), noteId: z.string().min(1).max(120).optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export const semanticIntakeSchema = z.object({
  priority: z.enum(NOTE_PRIORITIES).nullable(), priorityEvidence: z.string().max(1_000).nullable(),
  actions: z.array(z.object({
    title: z.string().trim().min(1).max(160), description: z.string().max(2_000).nullable(),
    status: z.enum(TASK_STATUSES), priority: z.enum(NOTE_PRIORITIES).nullable(),
    evidence: z.string().min(1).max(1_000),
  })).max(10),
});
export const captureCommitSchema = noteFieldsSchema.extend({
  requestId: z.string().min(8).max(120),
  tasks: z.array(taskCreateSchema.omit({ sourceNoteId: true, requestId: true, assigneeHqUserId: true, shareWithAssignee: true }).extend({
    actionKey: z.string().min(1).max(120), included: z.boolean(), evidence: z.string().max(1_000).nullable(),
  })).max(10).default([]),
});
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
export type SemanticIntake = z.infer<typeof semanticIntakeSchema>;
export type CaptureCommit = z.output<typeof captureCommitSchema>;
export type IntakeResult = {
  draftId: string; revision: number; overrideRevision: number; bodyHash: string; rosterHash: string;
  scope: string; preferenceVersion: number; priority: NotePriority; priorityEvidence: string | null;
  actions: Array<SemanticIntake["actions"][number] & { actionKey: string; included: boolean }>;
};
export type IntakePreference = { enabled: boolean; version: number; configured: boolean; scope: string };

export function redactIntakeText(text: string): string {
  return sanitizeBugReportConsoleText(text).replace(/\b\d{12,20}\b/g, "[redacted-id]");
}
export function intakeEvidenceIsValid(text: string, result: SemanticIntake): boolean {
  return (!result.priority || !!result.priorityEvidence && text.includes(result.priorityEvidence))
    && result.actions.every((action) => text.includes(action.evidence))
    && redactIntakeText(JSON.stringify(result)) === JSON.stringify(result);
}
export function intakeResultIsCurrent(result: IntakeResult, current: Pick<IntakeResult, "draftId" | "revision" | "overrideRevision" | "scope">): boolean {
  return result.draftId === current.draftId && result.revision === current.revision && result.overrideRevision === current.overrideRevision && result.scope === current.scope;
}
