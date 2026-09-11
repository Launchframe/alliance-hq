import type { NotePriority } from "@/lib/notes/workspace.shared";

export const PERFORMANCE_NOTE_KINDS = [
  "commendation",
  "violation",
  "note",
] as const;

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
  priority: NotePriority;
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

export type PerformanceNotesPagePayload = {
  notes: PerformanceNoteDto[];
  roster: PerformanceNoteRosterMember[];
  canCreate: boolean;
};
