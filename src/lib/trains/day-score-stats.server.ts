import "server-only";

import { resolveScoreDayRuleForTrainDate } from "@/lib/trains/train-day-context.server";
import {
  buildTrainDayScoreStats,
  scoreSourceContextForTrainDate,
  type TrainDayScoreStats,
} from "@/lib/trains/day-score-stats.shared";
import {
  conductorRuleUsesPriceIsFreightRoll,
  isHeavyHitterBoardRule,
} from "@/lib/trains/heavy-hitter-pool.shared";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import {
  countAllianceVrReporters,
} from "@/lib/trains/vr-reporter-count.server";
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import { listUnselectedPoolEntries } from "@/lib/trains/pool";
import { loadTimeOffAvailability } from "@/lib/time-off/availability.server";
import {
  buildUniformEconomyDrawSet,
} from "@/lib/trains/price-is-freight-roll.shared";
import { applyConductorMinimumsFilter, loadPriceIsFreightR3Candidates } from "@/lib/trains/price-is-freight-roll.server";
import { isVrTopScopeUnlocked } from "@/lib/trains/conductor-top-n.shared";
import { resolveVsBoardForTrainDate } from "@/lib/trains/vs-score-scope.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import { conductorRulePoolType } from "@/lib/trains/rules/derive.shared";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
  loadTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import { classifyVsDataNeed } from "@/lib/trains/vs-data-status.shared";
import {
  fetchAlliancePriorDayVsScoresByMember,
  fetchAllianceVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";

const VR_STATUS_LIMIT = 50;

type DayScoreStatsInput = {
  allianceId: string;
  trainDate: string;
  rule: ConductorRule | null;
  leadDays?: number;
  seasonKey?: string;
  /** Optional preloaded prior-day VS map keyed by recorded date. */
  vsScoresByRecordedDate?: Map<string, Map<string, number>>;
  /** Rule painted on the score reference day when lead time > 0. */
  scoreDayRule?: ConductorRule | null;
};

async function getPriorDayScores(
  allianceId: string,
  scoreDate: string,
  cache?: Map<string, Map<string, number>>,
): Promise<Map<string, number>> {
  const cached = cache?.get(scoreDate);
  if (cached) return cached;
  const scores = await fetchAlliancePriorDayVsScoresByMember(
    allianceId,
    scoreDate,
  );
  cache?.set(scoreDate, scores);
  return scores;
}

async function eligibleCountForDay(
  input: DayScoreStatsInput,
  scores: Map<string, number>,
): Promise<{ eligibleCount: number; topN?: number }> {
  const { awayMemberIds } = await loadTimeOffAvailability(input.allianceId, input.trainDate);
  const rule = input.rule;
  const leadDays = input.leadDays ?? 0;
  const topBoard = resolveVsBoardForTrainDate({
    trainRule: rule,
  });

  if (topBoard) {
    const top = await fetchAllianceVsTopScorersForTrainDate(
      input.allianceId,
      input.trainDate,
      topBoard.topN,
      input.leadDays ?? 0,
    );
    return { eligibleCount: top.filter((member) => !awayMemberIds.has(member.memberId)).length, topN: topBoard.topN };
  }

  if (rule?.kind === "vr_top_n") {
    const vrTopN = rule.topN;
    const reporterCount = await countAllianceVrReporters(input.allianceId);
    if (!isVrTopScopeUnlocked(vrTopN, reporterCount)) {
      return { eligibleCount: 0, topN: vrTopN };
    }
    const scorers = await fetchNativeVrTopScorers(input.allianceId, vrTopN);
    return {
      eligibleCount: Math.min(vrTopN, scorers.filter((member) => !awayMemberIds.has(member.memberId)).length),
      topN: vrTopN,
    };
  }

  if (conductorRuleUsesPriceIsFreightRoll(rule)) {
    if (isHeavyHitterBoardRule(rule)) {
      const hh = await applyConductorMinimumsFilter(input.allianceId, input.trainDate, await buildHeavyHitterPoolCandidates(
        input.allianceId,
        input.trainDate,
      ), { rule, leadDays });
      return { eligibleCount: hh.length };
    }

    const ticketSettings = await loadPriceIsRightTicketSettings(input.allianceId);
    const candidates = await loadPriceIsFreightR3Candidates({
      allianceId: input.allianceId,
      date: input.trainDate,
      rule,
      leadDays: input.leadDays ?? 0,
    });

    if (priceIsRightWeightingActive(ticketSettings)) {
      const weighted = await buildPriceIsRightWeightedCandidates({
        allianceId: input.allianceId,
        trainDate: input.trainDate,
        candidates,
        settings: ticketSettings,
        leadDays: input.leadDays ?? 0,
      });
      return { eligibleCount: weighted.candidates.length };
    }

    const economy = await loadTrainEconomyThreshold(input.allianceId, false);
    const { eligible } = buildUniformEconomyDrawSet({
      candidates,
      scores,
      settings: economy,
      maxTicketMemberIds: ticketSettings.maxTicketMemberIds,
    });
    return { eligibleCount: eligible.length };
  }

  const poolType = conductorRulePoolType(rule);
  if (poolType === "r3" || poolType === "heavy_hitter") {
    const entries = await listUnselectedPoolEntries(input.allianceId, poolType);
    return { eligibleCount: entries.filter((member) => !awayMemberIds.has(member.memberId)).length };
  }

  return { eligibleCount: scores.size };
}

/**
 * Score-source stats for one train day. Returns null when the day's rule does
 * not use VS/VR scores.
 */
export async function loadTrainDayScoreStats(
  input: DayScoreStatsInput,
): Promise<TrainDayScoreStats | null> {
  const leadDays = input.leadDays ?? 0;
  const scoreDayRule =
    input.seasonKey != null
      ? await resolveScoreDayRuleForTrainDate({
          allianceId: input.allianceId,
          trainDate: input.trainDate,
          leadDays,
          seasonKey: input.seasonKey,
          scoreDayRule: input.scoreDayRule,
        })
      : (input.scoreDayRule ?? null);
  const need = classifyVsDataNeed({
    rule: input.rule,
    trainDate: input.trainDate,
    leadDays,
    scoreDayRule,
  });

  if (need.kind === "none") {
    return null;
  }

  if (need.kind === "vr") {
    try {
      const topN =
        input.rule?.kind === "vr_top_n" ? input.rule.topN : undefined;
      const scorers = await fetchNativeVrTopScorers(
        input.allianceId,
        VR_STATUS_LIMIT,
      );
      const { eligibleCount } = await eligibleCountForDay(input, new Map());
      return buildTrainDayScoreStats({
        kind: "vr",
        required: true,
        scoreCount: scorers.length,
        eligibleCount,
        topN,
      });
    } catch {
      return buildTrainDayScoreStats({
        kind: "vr",
        required: true,
        scoreCount: 0,
        eligibleCount: 0,
      });
    }
  }

  const { scoreDate, vsDayKey } = scoreSourceContextForTrainDate(
    input.trainDate,
    leadDays,
  );
  try {
    const scores = await getPriorDayScores(
      input.allianceId,
      scoreDate,
      input.vsScoresByRecordedDate,
    );
    const { eligibleCount, topN } = await eligibleCountForDay(input, scores);
    return buildTrainDayScoreStats({
      kind: "prior_day_vs",
      required: need.required,
      scoreCount: scores.size,
      eligibleCount,
      scoreDate,
      vsDayKey,
      topN,
    });
  } catch {
    return buildTrainDayScoreStats({
      kind: "prior_day_vs",
      required: need.required,
      scoreCount: 0,
      eligibleCount: 0,
      scoreDate,
      vsDayKey,
    });
  }
}

/**
 * Load score stats for many train days, memoizing prior-day VS maps by
 * recorded date.
 */
export async function loadTrainDayScoreStatsForDates(
  allianceId: string,
  days: Array<{ trainDate: string; rule: ConductorRule | null }>,
  leadDays = 0,
  seasonKey?: string,
): Promise<Record<string, TrainDayScoreStats | null>> {
  const vsScoresByRecordedDate = new Map<string, Map<string, number>>();
  const configByDate = new Map(
    days.map((day) => [day.trainDate, day] as const),
  );
  const out: Record<string, TrainDayScoreStats | null> = {};

  await Promise.all(
    days.map(async (day) => {
      const scoreDayRule =
        leadDays > 0
          ? (configByDate.get(
              scoreSourceContextForTrainDate(day.trainDate, leadDays).scoreDate,
            )?.rule ?? null)
          : null;
      out[day.trainDate] = await loadTrainDayScoreStats({
        allianceId,
        trainDate: day.trainDate,
        rule: day.rule,
        leadDays,
        seasonKey,
        vsScoresByRecordedDate,
        scoreDayRule,
      });
    }),
  );

  return out;
}
