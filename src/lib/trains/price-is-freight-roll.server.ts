import "server-only";

import { loadActiveAlliancePoolMembers } from "@/lib/members/game-roster";
import { isPriceIsRightHeavyHitterSaturday } from "@/lib/trains/heavy-hitter-pool.shared";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import {
  pickUniformRollCandidate,
  pickWeightedRollCandidate,
} from "@/lib/trains/price-is-freight-roll.shared";
import {
  getAllianceRanksAsOf,
  isMemberEligibleForPool,
} from "@/lib/trains/rank-history";
import { throwPoolEmpty } from "@/lib/trains/roll-errors.server";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
  loadTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import { tpirEligibleLiveCandidates } from "@/lib/trains/train-economy-threshold.shared";
import { filterMemberIdsByConductorMinimums } from "@/lib/trains/train-conductor-minimums.server";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import type {
  ConductorMechanismType,
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
): Promise<RollCandidate[]> {
  const qualifiedIds = await filterMemberIdsByConductorMinimums(
    allianceId,
    trainDate,
    candidates.map((candidate) => candidate.memberId),
  );
  if (qualifiedIds == null) return candidates;
  const qualified = new Set(qualifiedIds);
  return candidates.filter((candidate) => qualified.has(candidate.memberId));
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
    const rank = rankEvent?.allianceRank ?? member.allianceRank ?? null;
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
}): Promise<RollResult> {
  const isSaturday = isPriceIsRightHeavyHitterSaturday(
    input.paintTemplate,
    input.date,
  );

  if (isSaturday || input.mechanism === "heavy_hitter_lottery") {
    const wheelCandidates = await applyConductorMinimumsFilter(
      input.allianceId,
      input.date,
      await buildHeavyHitterPoolCandidates(input.allianceId, input.date),
    );
    if (wheelCandidates.length === 0) {
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
  const r3Candidates = await loadPriceIsFreightR3Candidates({
    allianceId: input.allianceId,
    date: input.date,
  });

  if (priceIsRightWeightingActive(ticketSettings)) {
    const weighted = await buildPriceIsRightWeightedCandidates({
      allianceId: input.allianceId,
      trainDate: input.date,
      candidates: r3Candidates,
      settings: ticketSettings,
    });
    if (weighted.candidates.length === 0) {
      throwPoolEmpty("r3");
    }
    const winner = pickWeightedRollCandidate(weighted.candidates);
    if (!winner) {
      throwPoolEmpty("r3");
    }
    return {
      memberId: winner.memberId,
      memberName: winner.memberName,
      mechanism: "r3_lottery",
      isAutomatic: false,
      wheelCandidates: weighted.candidates,
    };
  }

  const economy = await loadTrainEconomyThreshold(input.allianceId, false);
  const scoreDate = vsScoreReferenceDate(input.date);
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
  if (eligible.length === 0) {
    throwPoolEmpty("r3");
  }
  const winner = pickUniformRollCandidate(eligible);
  if (!winner) {
    throwPoolEmpty("r3");
  }
  return {
    memberId: winner.memberId,
    memberName: winner.memberName,
    mechanism: "r3_lottery",
    isAutomatic: false,
    wheelCandidates: eligible,
  };
}
