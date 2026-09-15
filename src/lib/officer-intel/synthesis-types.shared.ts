import { z } from "zod";
import { taskPrioritySchema, type TaskStatus } from "@/lib/notes/tasks.shared";
import type { NotePriority } from "@/lib/notes/workspace.shared";

export const officerSynthesisActionItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  priority: taskPrioritySchema.default(null),
});

export const officerSynthesisOutputSchema = z.object({
  summary: z.string().min(1),
  keyDecisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  actionItems: z.array(officerSynthesisActionItemSchema).default([]),
});

export type OfficerSynthesisOutput = z.infer<typeof officerSynthesisOutputSchema>;

export type OfficerMeetingNoteStatus = "draft" | "approved";

export type OfficerActionItemStatus = TaskStatus;

export type OfficerActionItemPriority = NotePriority;

export type OfficerMeetingNoteSummary = {
  id: string;
  sessionId: string;
  summary: string;
  keyDecisions: string[];
  openQuestions: string[];
  status: OfficerMeetingNoteStatus;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OfficerActionItemRecord = {
  id: string;
  noteId: string | null;
  sessionId: string | null;
  title: string;
  description: string | null;
  status: OfficerActionItemStatus;
  priority: OfficerActionItemPriority;
  assigneeAllianceMemberId: string | null;
  assigneeNameRaw: string | null;
  assigneeMemberName: string | null;
  dueAt: string | null;
  dueHint: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
