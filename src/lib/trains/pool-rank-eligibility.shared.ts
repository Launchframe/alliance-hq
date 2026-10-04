import type { PoolType } from "@/lib/trains/types";

/** Rank-gated depleting pools whose current generation tracks roster rank. */
export const RANK_ELIGIBILITY_POOL_TYPES = ["r3", "r4_plus"] as const;

export type RankEligibilityPoolType = (typeof RANK_ELIGIBILITY_POOL_TYPES)[number];

export function isRankEligibilityPoolType(
  poolType: PoolType,
): poolType is RankEligibilityPoolType {
  return poolType === "r3" || poolType === "r4_plus";
}

function isRankEligibleForPool(
  poolType: RankEligibilityPoolType,
  rank: number | null,
): boolean {
  // Keep in lockstep with `isMemberEligibleForPool` for r3 / r4_plus.
  if (rank == null) return false;
  if (poolType === "r3") return rank === 3;
  return rank >= 4;
}

export type RankPoolEntrySnapshot = {
  id: string;
  memberId: string;
  memberName: string;
  allianceRank: number | null;
  selectedAt: string | Date | null;
};

export type RankPoolMemberSnapshot = {
  memberId: string;
  memberName: string;
  rank: number | null;
};

export type RankPoolEligibilityPlan = {
  unselectedEntryIdsToRemove: string[];
  membersToAdd: RankPoolMemberSnapshot[];
  unselectedNameUpdates: Array<{
    id: string;
    memberName: string;
    allianceRank: number | null;
  }>;
};

function isSelected(entry: RankPoolEntrySnapshot): boolean {
  return entry.selectedAt != null;
}

/**
 * Reconcile the **current** R3 / R4+ generation with live roster ranks.
 *
 * - Drop **unselected** rows whose member is gone or no longer rank-eligible
 *   (R3→R2, R3→R4, R4→R3, …). Selected rows stay as generation history.
 * - Admit currently eligible members who are not in this generation at all,
 *   **unless** they already have a selected row (thrash must not refresh
 *   eligibility inside one generation).
 * - Do not seed a generation that has never been created (`entries` empty).
 * - Do not reopen a fully selected generation — the next seed includes
 *   current ranks. Inserts only land while eligibility slots remain.
 */
export function planCurrentGenerationRankEligibilitySync(input: {
  poolType: RankEligibilityPoolType;
  entries: readonly RankPoolEntrySnapshot[];
  members: readonly RankPoolMemberSnapshot[];
}): RankPoolEligibilityPlan {
  if (input.entries.length === 0) {
    return {
      unselectedEntryIdsToRemove: [],
      membersToAdd: [],
      unselectedNameUpdates: [],
    };
  }

  const memberById = new Map(
    input.members.map((member) => [member.memberId, member]),
  );
  const selectedMemberIds = new Set(
    input.entries.filter(isSelected).map((entry) => entry.memberId),
  );

  const unselectedEntryIdsToRemove: string[] = [];
  const unselectedNameUpdates: RankPoolEligibilityPlan["unselectedNameUpdates"] =
    [];
  const remainingUnselectedMemberIds = new Set<string>();

  for (const entry of input.entries) {
    if (isSelected(entry)) continue;
    const member = memberById.get(entry.memberId);
    const eligible =
      member != null && isRankEligibleForPool(input.poolType, member.rank);
    if (!eligible) {
      unselectedEntryIdsToRemove.push(entry.id);
      continue;
    }
    remainingUnselectedMemberIds.add(entry.memberId);
    if (
      entry.memberName !== member.memberName ||
      entry.allianceRank !== member.rank
    ) {
      unselectedNameUpdates.push({
        id: entry.id,
        memberName: member.memberName,
        allianceRank: member.rank,
      });
    }
  }

  const membersToAdd: RankPoolMemberSnapshot[] = [];
  const generationStillOpen = remainingUnselectedMemberIds.size > 0;
  if (generationStillOpen) {
    for (const member of input.members) {
      if (!isRankEligibleForPool(input.poolType, member.rank)) continue;
      if (selectedMemberIds.has(member.memberId)) continue;
      if (remainingUnselectedMemberIds.has(member.memberId)) continue;
      membersToAdd.push(member);
    }
  }

  return {
    unselectedEntryIdsToRemove,
    membersToAdd,
    unselectedNameUpdates,
  };
}
