import {
  normalizeScoreValue,
  sanitizedNameKey,
} from "@/lib/video/normalize-rows";

export type ReviewRow = {
  id: string;
  memberId: string | null;
  memberName: string | null;
  ocrName?: string;
};

export type ScoreConflictReviewRow = {
  id: string;
  memberId: string | null;
  ocrName: string;
  score: string | null;
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

/**
 * Live score-conflict rows for review UI. OCR stamps `scoreConflict` at parse
 * time; that flag must not stay sticky after the officer deletes or edits the
 * conflicting sibling (same member / same OCR name with different scores).
 * Equal scores for the same member are duplicate-member, not conflict.
 *
 * An unmatched leftover with the same sanitized OCR name joins the matched
 * member group when exactly one member has that name, so matching one sibling
 * does not clear the conflict while the other score is still sitting unmatched.
 * Two different members who share an OCR name stay separate.
 */
export function liveScoreConflictRowIds(
  rows: ScoreConflictReviewRow[],
  allianceTag?: string | null,
): Set<string> {
  const memberGroups = new Map<string, ScoreConflictReviewRow[]>();
  const unmatchedByName = new Map<string, ScoreConflictReviewRow[]>();

  for (const row of rows) {
    if (row.memberId) {
      const group = memberGroups.get(row.memberId) ?? [];
      group.push(row);
      memberGroups.set(row.memberId, group);
      continue;
    }
    const nameKey = sanitizedNameKey(row.ocrName, allianceTag);
    if (!nameKey) continue;
    const group = unmatchedByName.get(nameKey) ?? [];
    group.push(row);
    unmatchedByName.set(nameKey, group);
  }

  const memberIdsByName = new Map<string, string[]>();
  for (const [memberId, group] of memberGroups) {
    const names = new Set(
      group
        .map((row) => sanitizedNameKey(row.ocrName, allianceTag))
        .filter((name) => name.length > 0),
    );
    for (const name of names) {
      const memberIds = memberIdsByName.get(name) ?? [];
      memberIds.push(memberId);
      memberIdsByName.set(name, memberIds);
    }
  }

  const groups: ScoreConflictReviewRow[][] = [...memberGroups.values()];
  for (const [nameKey, unmatched] of unmatchedByName) {
    const memberIds = memberIdsByName.get(nameKey) ?? [];
    if (memberIds.length === 1) {
      memberGroups.get(memberIds[0]!)!.push(...unmatched);
      continue;
    }
    groups.push(unmatched);
  }

  const conflictIds = new Set<string>();
  for (const group of groups) {
    if (group.length < 2) continue;
    const distinctScores = new Set(
      group.map((row) => normalizeScoreValue(row.score ?? "")),
    );
    if (distinctScores.size < 2) continue;
    for (const row of group) conflictIds.add(row.id);
  }
  return conflictIds;
}
