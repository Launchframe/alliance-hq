export type ReviewRow = {
  id: string;
  memberId: string | null;
  memberName: string | null;
  ocrName?: string;
};

export type DuplicateMemberIssue = {
  memberId: string;
  memberName: string;
  rowIds: string[];
};

export function findDuplicateMemberAssignments(
  rows: ReviewRow[],
): DuplicateMemberIssue[] {
  const byMember = new Map<string, DuplicateMemberIssue>();

  for (const row of rows) {
    if (!row.memberId) {
      continue;
    }

    const existing = byMember.get(row.memberId);
    if (existing) {
      existing.rowIds.push(row.id);
      continue;
    }

    byMember.set(row.memberId, {
      memberId: row.memberId,
      memberName: row.memberName ?? row.memberId,
      rowIds: [row.id],
    });
  }

  return [...byMember.values()].filter((issue) => issue.rowIds.length > 1);
}

export function duplicateMemberRowIds(issues: DuplicateMemberIssue[]): Set<string> {
  return new Set(issues.flatMap((issue) => issue.rowIds));
}
