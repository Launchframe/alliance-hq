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
 */
export function liveScoreConflictRowIds(
  rows: ScoreConflictReviewRow[],
  allianceTag?: string | null,
): Set<string> {
  const byKey = new Map<string, ScoreConflictReviewRow[]>();

  for (const row of rows) {
    const key = row.memberId
      ? `member:${row.memberId}`
      : `ocr:${sanitizedNameKey(row.ocrName, allianceTag)}`;
    if (!row.memberId && key === "ocr:") continue;
    const group = byKey.get(key) ?? [];
    group.push(row);
    byKey.set(key, group);
  }

  const conflictIds = new Set<string>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const distinctScores = new Set(
      group.map((row) => normalizeScoreValue(row.score ?? "")),
    );
    if (distinctScores.size < 2) continue;
    for (const row of group) conflictIds.add(row.id);
  }
  return conflictIds;
}
