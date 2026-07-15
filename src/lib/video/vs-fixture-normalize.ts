import type { VsScoreFixtureRow } from "@/lib/video/vs-fixture-types";

type RawAshedVsRow = {
  id?: string;
  member_id?: string;
  memberId?: string;
  member_name?: string;
  memberName?: string;
  current_name?: string;
  score?: number;
  points?: number;
  total?: number;
  rank?: number;
};

export function normalizeAshedVsRow(row: RawAshedVsRow): VsScoreFixtureRow | null {
  const name =
    row.member_name ?? row.memberName ?? row.current_name ?? null;
  if (!name) return null;

  const score = Number(row.score ?? row.points ?? row.total ?? 0);
  const memberId = row.member_id ?? row.memberId ?? row.id ?? undefined;

  return {
    name: String(name),
    score,
    rank: row.rank,
    memberId: memberId ? String(memberId) : undefined,
  };
}

/**
 * Normalize a batch of raw Ashed VSScore rows, sort by score descending,
 * and assign ranks if missing.
 */
export function normalizeAshedVsRows(
  rows: RawAshedVsRow[],
): VsScoreFixtureRow[] {
  const normalized = rows
    .map(normalizeAshedVsRow)
    .filter((r): r is VsScoreFixtureRow => r != null);

  normalized.sort((a, b) => b.score - a.score);

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i]!.rank == null) {
      normalized[i]!.rank = i + 1;
    }
  }

  return normalized;
}
