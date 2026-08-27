import "server-only";

import { resolveScoreDateDayConfigForTrainDate } from "@/lib/trains/train-day-context.server";
import { toDayMechanismConfig } from "@/lib/trains/train-day-context.shared";
import {
  buildTrainDayScoreStats,
  scoreSourceContextForTrainDate,
  type TrainDayScoreStats,
} from "@/lib/trains/day-score-stats.shared";
import {
  isPriceIsRightHeavyHitterSaturday,
  usesPriceIsFreightConductorRoll,
} from "@/lib/trains/heavy-hitter-pool.shared";
import { buildHeavyHitterPoolCandidates } from "@/lib/trains/heavy-hitter-pool.server";
import {
  countAllianceVrReporters,
} from "@/lib/trains/vr-reporter-count.server";
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import { getPoolSummary } from "@/lib/trains/pool";
import {
  buildUniformEconomyDrawSet,
} from "@/lib/trains/price-is-freight-roll.shared";
import { loadPriceIsFreightR3Candidates } from "@/lib/trains/price-is-freight-roll.server";
import {
  isVrTopScopeUnlocked,
  resolveConductorTopNBoard,
} from "@/lib/trains/conductor-top-n.shared";
import {
  resolveVsTopBoardForTrainDate,
  type DayMechanismConfig,
} from "@/lib/trains/vs-score-scope.shared";
import {
  buildPriceIsRightWeightedCandidates,
  loadPriceIsRightTicketSettings,
  loadTrainEconomyThreshold,
} from "@/lib/trains/train-economy-threshold.server";
import { priceIsRightWeightingActive } from "@/lib/trains/train-price-is-right-tickets.shared";
import type { WeekTemplateType } from "@/lib/trains/types";
import { classifyVsDataNeed } from "@/lib/trains/vs-data-status.shared";
import {
  fetchAlliancePriorDayVsScoresByMember,
  fetchAllianceVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";

const VR_STATUS_LIMIT = 50;

type DayScoreStatsInput = {
  allianceId: string;
  trainDate: string;
  conductorMechanism: string | null | undefined;
  paintTemplate?: string | null;
  conductorConfig?: unknown;
  leadDays?: number;
  seasonKey?: string;
  /** Optional preloaded prior-day VS map keyed by recorded date. */
  vsScoresByRecordedDate?: Map<string, Map<string, number>>;
  /** Score reference day's painted rule when lead time > 0. */
  scoreDateDay?: DayMechanismConfig | null;
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
  scoreDateDay?: DayMechanismConfig | null,
): Promise<{ eligibleCount: number; topN?: number }> {
  const mechanism = input.conductorMechanism;
  const paint = input.paintTemplate ?? null;
  const leadDays = input.leadDays ?? 0;
  const topBoard = resolveVsTopBoardForTrainDate({
    trainDate: input.trainDate,
    trainDay: {
      conductorMechanism: mechanism,
      conductorConfig: input.conductorConfig,
    },
    leadDays,
    scoreDateDay,
  });

  if (topBoard?.kind === "vs") {
    const top = await fetchAllianceVsTopScorersForTrainDate(
      input.allianceId,
      input.trainDate,
      topBoard.topN,
      input.leadDays ?? 0,
    );
    return { eligibleCount: top.length, topN: topBoard.topN };
  }

  if (topBoard?.kind === "vr") {
    const reporterCount = await countAllianceVrReporters(input.allianceId);
    if (!isVrTopScopeUnlocked(topBoard.topN, reporterCount)) {
      return { eligibleCount: 0, topN: topBoard.topN };
    }
    const scorers = await fetchNativeVrTopScorers(
      input.allianceId,
      topBoard.topN,
    );
    return {
      eligibleCount: Math.min(topBoard.topN, scorers.length),
      topN: topBoard.topN,
    };
  }

  if (usesPriceIsFreightConductorRoll(paint)) {
    if (isPriceIsRightHeavyHitterSaturday(paint as never, input.trainDate)) {
      const hh = await buildHeavyHitterPoolCandidates(
        input.allianceId,
        input.trainDate,
      );
      return { eligibleCount: hh.length };
    }

    const ticketSettings = await loadPriceIsRightTicketSettings(input.allianceId);
    const candidates = await loadPriceIsFreightR3Candidates({
      allianceId: input.allianceId,
      date: input.trainDate,
      paintTemplate: paint as WeekTemplateType | null,
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

  if (mechanism === "r3_lottery" || mechanism === "heavy_hitter_lottery") {
    const poolType =
      mechanism === "heavy_hitter_lottery" ? "heavy_hitter" : "r3";
    const summary = await getPoolSummary(input.allianceId, poolType);
    return { eligibleCount: summary.remaining };
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
  const scoreDateDay =
    input.seasonKey != null
      ? await resolveScoreDateDayConfigForTrainDate({
          allianceId: input.allianceId,
          trainDate: input.trainDate,
          leadDays,
          seasonKey: input.seasonKey,
          scoreDateDay: input.scoreDateDay,
        })
      : (input.scoreDateDay ?? null);
  const need = classifyVsDataNeed({
    conductorMechanism: input.conductorMechanism,
    paintTemplate: input.paintTemplate,
    trainDate: input.trainDate,
    leadDays,
    scoreDateDay,
  });

  if (need.kind === "none") {
    return null;
  }

  if (need.kind === "vr") {
    try {
      const topBoard = resolveConductorTopNBoard(
        input.conductorMechanism,
        input.conductorConfig,
      );
      const topN = topBoard?.kind === "vr" ? topBoard.topN : undefined;
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
    const { eligibleCount, topN } = await eligibleCountForDay(
      input,
      scores,
      scoreDateDay,
    );
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
  days: Array<{
    trainDate: string;
    conductorMechanism: string | null | undefined;
    paintTemplate?: string | null;
    conductorConfig?: unknown;
  }>,
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
      const scoreDateDayRow =
        leadDays > 0
          ? configByDate.get(
              scoreSourceContextForTrainDate(day.trainDate, leadDays).scoreDate,
            )
          : undefined;
      const scoreDateDay = scoreDateDayRow
        ? toDayMechanismConfig(scoreDateDayRow)
        : null;
      out[day.trainDate] = await loadTrainDayScoreStats({
        allianceId,
        trainDate: day.trainDate,
        conductorMechanism: day.conductorMechanism,
        paintTemplate: day.paintTemplate,
        conductorConfig: day.conductorConfig,
        leadDays,
        seasonKey,
        vsScoresByRecordedDate,
        scoreDateDay,
      });
    }),
  );

  return out;
}
