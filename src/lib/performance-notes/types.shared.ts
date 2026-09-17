import type { NotePriority } from "@/lib/notes/workspace.shared";

export const PERFORMANCE_NOTE_KINDS = [
  "commendation",
  "violation",
  "note",
] as const;

import type { CaptureProvenance } from "@/lib/notes/drafts.shared";

export type PerformanceNoteKind = (typeof PERFORMANCE_NOTE_KINDS)[number];

export const PERFORMANCE_NOTE_INTAKE_MODES = ["batch", "thought"] as const;

export type PerformanceNoteIntakeMode =
  (typeof PERFORMANCE_NOTE_INTAKE_MODES)[number];

export type PerformanceNoteMemberDto = {
  ashedMemberId: string;
  name: string;
  origin: "manual" | "detected";
};

export type PerformanceNoteDto = {
  id: string;
  kind: PerformanceNoteKind;
  intakeMode: PerformanceNoteIntakeMode;
  body: string;
  title: string;
  documentType?: import("@/lib/notes/workspace.shared").NoteDocumentType;
  keyDecisions?: string[];
  openQuestions?: string[];
  priority: NotePriority;
  priorityMode: "manual" | "auto";
  intakeProvenance?: CaptureProvenance | null;
  labels: string[];
  notebook: string | null;
  journalDate: string | null;
  inbox: boolean;
  archived: boolean;
  excludedMemberIds: string[];
  source: "discord" | "web";
  createdAt: string;
  updatedAt: string;
  version: number;
  canEdit: boolean;
  isOwner: boolean;
  shared: boolean;
  members: PerformanceNoteMemberDto[];
};

export type PerformanceNoteRosterMember = {
  ashedMemberId: string;
  name: string;
  previousNames?: string[];
};

export type PerformanceNoteSummary = Pick<PerformanceNoteDto, "id" | "kind" | "title" | "priority" | "labels" | "notebook" | "inbox" | "archived" | "source" | "createdAt" | "updatedAt" | "version" | "canEdit" | "isOwner" | "shared" | "members"> & { excerpt: string };
export type NotesListPage = {
  scope: string;
  items: PerformanceNoteSummary[];
  nextCursor: string | null;
  previousCursor: string | null;
  filter: import("@/lib/notes/workspace.shared").NoteListFilter;
  counts: Record<"notebook" | "inbox" | "shared" | "archived", number>;
  notebooks: string[];
};
export type NotesWorkspacePayload = NotesListPage & {
  preferences: import("@/lib/notes/workspace.shared").WorkspacePreferences;
  roster: PerformanceNoteRosterMember[];
  canCreate: boolean;
  canReadBoards: boolean;
  draftCount: number;
};

export type PerformanceNotesPagePayload = {
  notes: PerformanceNoteDto[];
  roster: PerformanceNoteRosterMember[];
  canCreate: boolean;
  canReadBoards?: boolean;
  draftCount?: number;
};
