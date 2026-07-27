export const VS_COMPLIANCE_OUTCOMES = ["ok", "miss", "waived"] as const;
export type VsComplianceOutcome = (typeof VS_COMPLIANCE_OUTCOMES)[number];

export const VS_COMPLIANCE_OFFICER_TASK_STATUSES = [
  "none",
  "open",
  "completed",
  "waived",
] as const;
export type VsComplianceOfficerTaskStatus =
  (typeof VS_COMPLIANCE_OFFICER_TASK_STATUSES)[number];

export type VsMembershipSettings = {
  minPoints: number | null;
  missStrikesBeforeKick: number;
  leewayPct: number;
};

export type SerializedVsComplianceEvent = {
  id: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  vsWeekEnding: string;
  score: number;
  threshold: number;
  excused: boolean;
  outcome: VsComplianceOutcome;
  strikeNumber: number | null;
  officerTaskStatus: VsComplianceOfficerTaskStatus;
  waiveReason: string | null;
  createdAt: string;
  updatedAt: string;
};
