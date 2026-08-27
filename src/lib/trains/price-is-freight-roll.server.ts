import "server-only";

import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import { filterDaySpinCandidates } from "@/lib/trains/day-spin-exclusions.shared";
import { isPriceIsRightHeavyHitterSaturday } from "@/lib/trains/heavy-hitter-pool.shared";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import {
  classifyPriceIsFreightEmptyReason,
  pickUniformRollCandidate,
  pickWeightedRollCandidate,
} from "@/lib/trains/price-is-freight-roll.shared";
import {
  getAllianceRanksAsOf,
  isMemberEligibleForPool,
  resolveMemberPoolAllianceRank,
} from "@/lib/trains/rank-history";
import {
  throwNoWheelCandidates,
  throwPoolEmpty,
  throwPoolUnavailable,
} from "@/lib/trains/roll-errors.server";
import { filterMemberIdsByConductorMinimums } from "@/lib/trains/train-conductor-minimums.server";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
  loadTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import { tpirEligibleLiveCandidates } from "@/lib/trains/train-economy-threshold.shared";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import type {
  ConductorMechanismType,
  PoolType,
  RollCandidate,
  RollResult,
  WeekTemplateType,
} from "@/lib/trains/types";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

async function applyConductorMinimumsFilter(
  allianceId: string,
  trainDate: string,
  candidates: RollCandidate[],
  options?: {
    paintTemplate?: WeekTemplateType | null;
    leadDays?: number;
  },
): Promise<RollCandidate[]> {
  const qualifiedIds = await filterMemberIdsByConductorMinimums(
    allianceId,
    trainDate,
    candidates.map((candidate) => candidate.memberId),
    options,
  );
  if (qualifiedIds == null) return candidates;
  const qualified = new Set(qualifiedIds);
  return candidates.filter((candidate) => qualified.has(candidate.memberId));
}

function throwFromPriceIsFreightEmptyReason(
  poolType: PoolType,
  reason: NonNullable<ReturnType<typeof classifyPriceIsFreightEmptyReason>>,
): never {
  if (reason.kind === "no_roster_candidates") {
    throwPoolEmpty(poolType);
  }
  if (reason.kind === "missing_vs_scores") {
    throwNoWheelCandidates("vs", "No VS scores found for the wheel.", {
      scoreDate: reason.scoreDate,
      leadDays: reason.leadDays,
    });
  }
  throwPoolUnavailable(poolType);
}

export async function loadPriceIsFreightR3Candidates(input: {
  allianceId: string;
  date: string;
}): Promise<RollCandidate[]> {
  const [members, rankEvents] = await Promise.all([
    loadActiveAlliancePoolMembers({ allianceId: input.allianceId }),
    getAllianceRanksAsOf(input.allianceId, input.date),
  ]);
  const rankByMember = new Map(
    rankEvents.map((event) => [event.ashedMemberId, event]),
  );

  const candidates: RollCandidate[] = [];
  for (const member of members) {
    const rankEvent = rankByMember.get(member.ashedMemberId);
    const rank = resolveMemberPoolAllianceRank(member, rankEvent);
    if (!isMemberEligibleForPool("r3", rank)) continue;
    candidates.push({
      memberId: member.ashedMemberId,
      memberName: member.currentName,
      allianceRank: rank,
    });
  }
  return applyConductorMinimumsFilter(input.allianceId, input.date, candidates);
}

/**
 * With-replacement Price Is Freight conductor draw. Does not seed, mark, or
 * reseed `conductor_pool_entries`.
 */
export async function rollPriceIsFreightConductor(input: {
  allianceId: string;
  date: string;
  paintTemplate: WeekTemplateType | null | undefined;
  mechanism: ConductorMechanismType;
  /** Day-scoped re-spin exclusions (does not touch depleting pools). */
  excludedMemberIds?: ReadonlySet<string>;
}): Promise<RollResult> {
  const isSaturday = isPriceIsRightHeavyHitterSaturday(
    input.paintTemplate,
    input.date,
  );
  const excluded = input.excludedMemberIds ?? new Set<string>();
  const leadDays = await loadAllianceTrainLeadTimeDays(input.allianceId);
  const scoreDate = vsScoreReferenceDate(input.date, leadDays);

  if (isSaturday || input.mechanism === "heavy_hitter_lottery") {
    const rosterCandidates = await applyConductorMinimumsFilter(
      input.allianceId,
      input.date,
      await buildHeavyHitterPoolCandidates(input.allianceId, input.date),
      { paintTemplate: input.paintTemplate, leadDays },
    );
    const wheelCandidates = filterDaySpinCandidates(rosterCandidates, excluded);
    if (wheelCandidates.length === 0) {
      // Saturday HH list is settings-configured, not VS-band filtered here.
      throwPoolEmpty("heavy_hitter");
    }
    const winner = pickUniformRollCandidate(wheelCandidates);
    if (!winner) {
      throwPoolEmpty("heavy_hitter");
    }
    return {
      memberId: winner.memberId,
      memberName: winner.memberName,
      mechanism: "heavy_hitter_lottery",
      isAutomatic: false,
      wheelCandidates,
    };
  }

  const ticketSettings = await loadPriceIsRightTicketSettings(input.allianceId);
  const rosterR3 = await loadPriceIsFreightR3Candidates({
    allianceId: input.allianceId,
    date: input.date,
  });
  const r3Candidates = filterDaySpinCandidates(rosterR3, excluded);

  if (priceIsRightWeightingActive(ticketSettings)) {
    if (rosterR3.length === 0) {
      throwPoolEmpty("r3");
    }
    if (r3Candidates.length === 0) {
      throwNoWheelCandidates(
        "vs",
        "Everyone eligible for this day's raffle was already drawn.",
        { spinBlockReason: "day_spin_exhausted" },
      );
    }
    const weighted = await buildPriceIsRightWeightedCandidates({
      allianceId: input.allianceId,
      trainDate: input.date,
      candidates: r3Candidates,
      settings: ticketSettings,
      leadDays,
    });
    const vsScores = await fetchAlliancePriorDayVsScoresByMember(
      input.allianceId,
      scoreDate,
    );
    const emptyReason = classifyPriceIsFreightEmptyReason({
      rosterCandidateCount: rosterR3.length,
      scoreDate,
      leadDays,
      vsScoreMemberCount: vsScores.size,
      eligibleCount: weighted.candidates.length,
    });
    if (emptyReason) {
      throwFromPriceIsFreightEmptyReason("r3", emptyReason);
    }
    const winner = pickWeightedRollCandidate(weighted.candidates);
    if (!winner) {
      throwPoolUnavailable("r3");
    }
    return {
      memberId: winner.memberId,
      memberName: winner.memberName,
      mechanism: "r3_lottery",
      isAutomatic: false,
      wheelCandidates: weighted.candidates,
    };
  }

  if (rosterR3.length === 0) {
    throwPoolEmpty("r3");
  }
  if (r3Candidates.length === 0) {
    throwNoWheelCandidates(
      "vs",
      "Everyone eligible for this day's raffle was already drawn.",
      { spinBlockReason: "day_spin_exhausted" },
    );
  }

  const economy = await loadTrainEconomyThreshold(input.allianceId, false);
  const vsScores = await fetchAlliancePriorDayVsScoresByMember(
    input.allianceId,
    scoreDate,
  );
  const eligible = tpirEligibleLiveCandidates(
    r3Candidates,
    vsScores,
    economy,
    ticketSettings.maxTicketMemberIds,
  );
  const emptyReason = classifyPriceIsFreightEmptyReason({
    rosterCandidateCount: rosterR3.length,
    scoreDate,
    leadDays,
    vsScoreMemberCount: vsScores.size,
    eligibleCount: eligible.length,
  });
  if (emptyReason) {
    throwFromPriceIsFreightEmptyReason("r3", emptyReason);
  }
  const winner = pickUniformRollCandidate(eligible);
  if (!winner) {
    throwPoolUnavailable("r3");
  }
  return {
    memberId: winner.memberId,
    memberName: winner.memberName,
    mechanism: "r3_lottery",
    isAutomatic: false,
    wheelCandidates: eligible,
  };
}
