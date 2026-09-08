export type CoverageConflict = {
  assignmentId: string;
  assignmentVersion: string;
  dutyDate: string;
  dutyRole: "conductor" | "vip" | "engineer";
  memberId: string;
  memberName: string;
  lockedAt: string | null;
  absenceVersion: string;
  dutyStartAt?: string;
  dutyEndAt?: string;
  coverageStartHour?: number;
  coverageEndHour?: number;
};

export type CoverageRouting = { kind: "alliance_leadership" | "team_lead"; hqUserId: string; name: string };
export type CoverageRoutingResolver = (allianceId: string, conflict: CoverageConflict) => Promise<CoverageRouting | null>;

export type CoverageAcceptance = {
  conflicts: CoverageConflict[];
  note: string;
  requestId: string;
};

export function sameCoverageConflict(a: CoverageConflict, b: CoverageConflict): boolean {
  return a.assignmentId === b.assignmentId && a.assignmentVersion === b.assignmentVersion &&
    a.dutyDate === b.dutyDate && a.dutyRole === b.dutyRole && a.memberId === b.memberId &&
    a.memberName === b.memberName && a.lockedAt === b.lockedAt && a.absenceVersion === b.absenceVersion &&
    a.dutyStartAt === b.dutyStartAt && a.dutyEndAt === b.dutyEndAt &&
    a.coverageStartHour === b.coverageStartHour && a.coverageEndHour === b.coverageEndHour;
}

export function acceptsCoverage(conflicts: CoverageConflict[], acceptance: CoverageAcceptance | undefined): boolean {
  return !!acceptance && typeof acceptance.note === "string" && acceptance.note.trim().length > 0 &&
    acceptance.note.length <= 500 && /^[a-zA-Z0-9_-]{16,100}$/.test(acceptance.requestId) &&
    Array.isArray(acceptance.conflicts) && conflicts.every((conflict) => acceptance.conflicts.some((accepted) =>
      !!accepted && sameCoverageConflict(conflict, accepted)));
}
