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
 * Blank-score rows whose matched member also has a scored row. The blank row is
 * a missed read of the same player, so it is discarded rather than reviewed.
 */
export function blankScoreSupersededRowIds(
  rows: readonly { id: string; memberId: string | null; score: string | null }[],
): Set<string> {
  const scoredMembers = new Set<string>();
  for (const row of rows) {
    if (row.memberId && normalizeScoreValue(row.score ?? "") !== "") {
      scoredMembers.add(row.memberId);
    }
  }
  const superseded = new Set<string>();
  for (const row of rows) {
    if (
      row.memberId &&
      scoredMembers.has(row.memberId) &&
      normalizeScoreValue(row.score ?? "") === ""
    ) {
      superseded.add(row.id);
    }
  }
  return superseded;
}

/**
 * Live score-conflict groups for review UI. OCR stamps `scoreConflict` at parse
 * time; that flag must not stay sticky after the officer deletes or edits the
 * conflicting sibling (same member / same OCR name with different scores).
 * Equal scores for the same member are duplicate-member, not conflict, and a
 * blank score is a missed read — it never conflicts with a real score.
 *
 * An unmatched leftover with the same sanitized OCR name joins the matched
 * member group when exactly one member has that name, so matching one sibling
 * does not clear the conflict while the other score is still sitting unmatched.
 * Two different members who share an OCR name stay separate.
 *
 * Each returned group lists every sibling row (blank-score rows included) so
 * the UI can keep them together; only scored rows are conflicts.
 */
export function liveScoreConflictGroups(
  rows: ScoreConflictReviewRow[],
  allianceTag?: string | null,
): { rowIds: string[]; conflictRowIds: string[] }[] {
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

  const result: { rowIds: string[]; conflictRowIds: string[] }[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const scored = group.filter(
      (row) => normalizeScoreValue(row.score ?? "") !== "",
    );
    const distinctScores = new Set(
      scored.map((row) => normalizeScoreValue(row.score ?? "")),
    );
    if (distinctScores.size < 2) continue;
    result.push({
      rowIds: group.map((row) => row.id),
      conflictRowIds: scored.map((row) => row.id),
    });
  }
  return result;
}

export function liveScoreConflictRowIds(
  rows: ScoreConflictReviewRow[],
  allianceTag?: string | null,
): Set<string> {
  return new Set(
    liveScoreConflictGroups(rows, allianceTag).flatMap(
      (group) => group.conflictRowIds,
    ),
  );
}

/**
 * Rows that must render side by side: duplicate-member groups merged with
 * score-conflict groups. Overlapping groups collapse into one.
 */
export function mergeSiblingGroups(
  groups: readonly (readonly string[])[],
): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const group of groups) {
    for (const id of group) if (!parent.has(id)) parent.set(id, id);
    for (let i = 1; i < group.length; i++) {
      parent.set(find(group[i]!), find(group[0]!));
    }
  }
  const merged = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const members = merged.get(root) ?? [];
    members.push(id);
    merged.set(root, members);
  }
  return [...merged.values()].filter((group) => group.length > 1);
}

/**
 * Keep the base order (rank), but pull every sibling group together at the
 * position of its first row so pairs never sit apart.
 */
export function groupSiblingRowsTogether<T extends { id: string }>(
  rows: readonly T[],
  groups: readonly (readonly string[])[],
): T[] {
  const groupByRowId = new Map<string, readonly string[]>();
  for (const group of groups) {
    for (const id of group) groupByRowId.set(id, group);
  }
  if (groupByRowId.size === 0) return [...rows];

  const emitted = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (emitted.has(row.id)) continue;
    const group = groupByRowId.get(row.id);
    if (!group) {
      result.push(row);
      emitted.add(row.id);
      continue;
    }
    const members = new Set(group);
    for (const sibling of rows) {
      if (members.has(sibling.id) && !emitted.has(sibling.id)) {
        result.push(sibling);
        emitted.add(sibling.id);
      }
    }
  }
  return result;
}
