export const ROSTER_MAX_MEMBERS = 100;
export const ROSTER_MAX_R4 = 10;
export const ROSTER_R5_REQUIRED = 1;

export type ExistingRosterMemberForQuota = {
  ashedMemberId: string;
  allianceRank: number | null;
  status?: string | null;
};

export type RosterCommitRowForQuota = {
  matchMemberId: string | null;
  allianceRank: number;
};

export type RosterRankCounts = {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  r5: number;
  total: number;
};

export type RosterRankQuotaErrorCode =
  | "r5_required"
  | "r5_multiple"
  | "r4_max"
  | "total_max"
  | "r123_when_r4_full"
  | "solo_must_be_r5";

function emptyCounts(): RosterRankCounts {
  return { r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, total: 0 };
}

function addRank(counts: RosterRankCounts, rank: number): void {
  if (rank === 1) counts.r1 += 1;
  else if (rank === 2) counts.r2 += 1;
  else if (rank === 3) counts.r3 += 1;
  else if (rank === 4) counts.r4 += 1;
  else if (rank === 5) counts.r5 += 1;
}

/** Project full alliance rank counts after applying roster commit rows. */
export function computeProjectedRosterRankCounts(
  existing: ExistingRosterMemberForQuota[],
  commitRows: RosterCommitRowForQuota[],
): RosterRankCounts {
  const active = existing.filter((member) => member.status !== "former");
  const projected = new Map<string, number | null>(
    active.map((member) => [member.ashedMemberId, member.allianceRank]),
  );

  const newRanks: number[] = [];

  for (const row of commitRows) {
    if (row.matchMemberId) {
      projected.set(row.matchMemberId, row.allianceRank);
    } else {
      newRanks.push(row.allianceRank);
    }
  }

  const counts = emptyCounts();
  counts.total = projected.size + newRanks.length;

  for (const rank of projected.values()) {
    if (rank != null && rank >= 1 && rank <= 5) {
      addRank(counts, rank);
    }
  }
  for (const rank of newRanks) {
    addRank(counts, rank);
  }

  return counts;
}

export function validateRosterRankQuota(
  counts: RosterRankCounts,
): RosterRankQuotaErrorCode[] {
  const errors: RosterRankQuotaErrorCode[] = [];

  if (counts.r5 !== ROSTER_R5_REQUIRED) {
    errors.push(counts.r5 === 0 ? "r5_required" : "r5_multiple");
  }
  if (counts.r4 > ROSTER_MAX_R4) {
    errors.push("r4_max");
  }
  if (counts.total > ROSTER_MAX_MEMBERS) {
    errors.push("total_max");
  }
  if (counts.r4 === ROSTER_MAX_R4 && counts.r1 + counts.r2 + counts.r3 > 89) {
    errors.push("r123_when_r4_full");
  }
  if (counts.total === 1 && counts.r5 !== 1) {
    errors.push("solo_must_be_r5");
  }

  return errors;
}
