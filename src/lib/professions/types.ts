export type Profession = "Engineer" | "War Leader";

export type WlEngAssignmentStatus = "active" | "dismissed" | "self_removed";

export type WlTeamEventKind =
  | "eng_assigned"
  | "eng_dismissed"
  | "eng_self_removed"
  | "more_engs_requested"
  | "profession_switched";

/** A single Eng as seen from the WL's dashboard */
export type AssignedEngRow = {
  assignmentId: string;
  engCommanderId: string;
  engName: string | null;
  assignedAt: Date;
  coverageStartHour: number | null;
  coverageEndHour: number | null;
  status: WlEngAssignmentStatus;
};

/** A WL team as seen by an Eng looking for a WL to support */
export type WlSuggestion = {
  wlCommanderId: string;
  wlName: string | null;
  activeEngCount: number;
  minEngsPerTeam: number;
  assignedEngNames: string[];
  isCovered: boolean;
  wlTeamId: string | null;
};

/** Full team context returned for the Eng's "my team" view */
export type MyEngTeamContext = {
  assignment: {
    assignmentId: string;
    wlTeamId: string;
    wlCommanderId: string;
    wlName: string | null;
    assignedAt: Date;
    coverageStartHour: number | null;
    coverageEndHour: number | null;
  } | null;
  teamEngs: AssignedEngRow[];
  teamEngCount: number;
  minEngsPerTeam: number;
  professionSince: string | null;
};

/** Full team context returned for the WL's intelligence dashboard */
export type MyWlTeamContext = {
  wlTeamId: string | null;
  activeEngs: AssignedEngRow[];
  minEngsPerTeam: number;
  isCovered: boolean;
  professionSince: string | null;
};

/** A row in the officer profession overview */
export type OfficerWlRow = {
  wlCommanderId: string;
  wlName: string | null;
  wlTeamId: string | null;
  activeEngCount: number;
  minEngsPerTeam: number;
  isCovered: boolean;
  assignedEngNames: string[];
};

/** A row for an unassigned Engineer in the officer view */
export type OfficerUnassignedEngRow = {
  engCommanderId: string;
  engName: string | null;
  profession: string | null;
};

/** An event in the officer activity feed */
export type OfficerActivityEvent = {
  id: string;
  eventKind: WlTeamEventKind;
  actorCommanderId: string | null;
  actorName: string | null;
  subjectCommanderId: string | null;
  subjectName: string | null;
  createdAt: Date;
  details: Record<string, unknown> | null;
};
