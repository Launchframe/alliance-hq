import type { TrainEconomyThresholdSettings } from "@/lib/trains/train-economy-threshold.shared";
import {
  tpirEligibleLiveCandidates,
  vsScoreForEconomyDraw,
} from "@/lib/trains/train-economy-threshold.shared";
import type {
  PriceIsRightMissedFloorEntry,
  PriceIsRightTicketBoardEntry,
  PriceIsRightTicketCandidate,
} from "@/lib/trains/train-price-is-right-tickets.shared";
import type { RollCandidate } from "@/lib/trains/types";

export type PriceIsFreightOddsMode = "weighted" | "uniform" | "heavy_hitter";

/** Uniform or heavy-hitter equal-chance board from an eligible candidate list. */
export function buildEqualChanceOddsBoard(
  eligible: Array<
    PriceIsRightTicketCandidate & {
      priorDayVsScore?: number | null;
      isTakedownOverride?: boolean;
    }
  >,
  viewerMemberId?: string | null,
): PriceIsRightTicketBoardEntry[] {
  const n = eligible.length;
  const winProbability = n > 0 ? 1 / n : 0;
  return [...eligible]
    .map((entry) => ({
      memberId: entry.memberId,
      memberName: entry.memberName,
      priorDayVsScore: entry.priorDayVsScore ?? 0,
      ticketCount: 1,
      winProbability,
      isTakedownOverride: entry.isTakedownOverride ?? false,
      isViewer: viewerMemberId != null && entry.memberId === viewerMemberId,
    }))
    .sort((a, b) =>
      a.memberName.localeCompare(b.memberName, undefined, {
        sensitivity: "base",
      }),
    );
}

/**
 * Filter live R3 candidates for a uniform economy draw and build excluded list
 * (members with a prior-day score who are outside the band).
 */
export function buildUniformEconomyDrawSet(input: {
  candidates: PriceIsRightTicketCandidate[];
  scores: Map<string, number>;
  settings: TrainEconomyThresholdSettings;
  maxTicketMemberIds: readonly string[];
  viewerMemberId?: string | null;
}): {
  eligible: PriceIsRightTicketBoardEntry[];
  excluded: PriceIsRightMissedFloorEntry[];
} {
  const overrides = new Set(input.maxTicketMemberIds);
  const eligibleCandidates = tpirEligibleLiveCandidates(
    input.candidates,
    input.scores,
    input.settings,
    input.maxTicketMemberIds,
  );
  const eligibleIds = new Set(eligibleCandidates.map((c) => c.memberId));

  const eligible = buildEqualChanceOddsBoard(
    eligibleCandidates.map((c) => ({
      ...c,
      priorDayVsScore: vsScoreForEconomyDraw(input.scores.get(c.memberId)),
      isTakedownOverride: overrides.has(c.memberId),
    })),
    input.viewerMemberId,
  );

  const excluded: PriceIsRightMissedFloorEntry[] = input.candidates
    .filter((c) => !eligibleIds.has(c.memberId) && input.scores.has(c.memberId))
    .map((c) => ({
      memberId: c.memberId,
      memberName: c.memberName,
      priorDayVsScore: input.scores.get(c.memberId)!,
      isViewer: input.viewerMemberId != null && c.memberId === input.viewerMemberId,
    }))
    .sort((a, b) => a.priorDayVsScore - b.priorDayVsScore);

  return { eligible, excluded };
}

export function pickUniformRollCandidate<T>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export function pickWeightedRollCandidate(
  candidates: RollCandidate[],
): RollCandidate | null {
  const weighted = candidates.filter(
    (c) => (c.ticketCount ?? 0) > 0,
  );
  if (weighted.length === 0) return null;

  const totalWeight = weighted.reduce(
    (sum, c) => sum + (c.ticketCount ?? 0),
    0,
  );
  if (totalWeight <= 0) {
    return pickUniformRollCandidate(weighted);
  }

  let roll = Math.random() * totalWeight;
  for (const candidate of weighted) {
    roll -= candidate.ticketCount ?? 0;
    if (roll <= 0) return candidate;
  }
  return weighted[weighted.length - 1] ?? null;
}
