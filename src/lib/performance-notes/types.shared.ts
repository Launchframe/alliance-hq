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
};

export type PerformanceNoteDto = {
  id: string;
  kind: PerformanceNoteKind;
  intakeMode: PerformanceNoteIntakeMode;
  body: string;
  source: "discord" | "web";
  createdAt: string;
  members: PerformanceNoteMemberDto[];
};

export type PerformanceNoteRosterMember = {
  ashedMemberId: string;
  name: string;
};

export type PerformanceNotesPagePayload = {
  notes: PerformanceNoteDto[];
  roster: PerformanceNoteRosterMember[];
};
