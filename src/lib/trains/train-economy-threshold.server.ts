import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import type { RollCandidate } from "@/lib/trains/types";
import {
  buildPriceIsRightTicketBoard,
  isCliffValidForWeighting,
  normalizePriceIsRightTicketSettings,
  priceIsRightWeightingActive,
  resolveCliffPoints,
  type PriceIsRightTicketBoardEntry,
  type PriceIsRightMissedFloorEntry,
  type PriceIsRightTicketSettings,
} from "@/lib/trains/train-price-is-right-tickets.shared";
import {
  economyThresholdEnforcementEnabled,
  normalizeTrainEconomyThresholdSettings,
  PRICE_IS_RIGHT_MIN_VS_SCORE,
  tpirEligiblePoolEntries,
  type TrainEconomyThresholdSettings,
} from "@/lib/trains/train-economy-threshold.shared";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export type TrainEconomyThresholdRow = TrainEconomyThresholdSettings &
  PriceIsRightTicketSettings & {
    canManage: boolean;
    effectiveCliffPoints: number | null;
  };

export { PRICE_IS_RIGHT_MIN_VS_SCORE };

function allianceRowToPriceIsRightSettings(row: {
  trainPriceIsRightWeightingEnabled?: number | null;
  trainPriceIsRightHardCutoffEnabled?: number | null;
  trainPriceIsRightMaxTicketMemberIds?: unknown;
  trainEconomyThresholdPoints?: number | null;
}): PriceIsRightTicketSettings {
  return normalizePriceIsRightTicketSettings({
    weightingEnabled: row.trainPriceIsRightWeightingEnabled,
    cliffPoints: row.trainEconomyThresholdPoints ?? null,
    hardCutoffEnabled: row.trainPriceIsRightHardCutoffEnabled,
    maxTicketMemberIds: row.trainPriceIsRightMaxTicketMemberIds,
  });
}

export async function loadTrainEconomyThreshold(
  allianceId: string,
  canManage: boolean,
): Promise<TrainEconomyThresholdRow> {
  const db = getDb();
  const [row] = await db
    .select({
      thresholdPoints: schema.alliances.trainEconomyThresholdPoints,
      fudgePct: schema.alliances.trainEconomyThresholdFudgePct,
      weightingEnabled: schema.alliances.trainPriceIsRightWeightingEnabled,
      hardCutoffEnabled: schema.alliances.trainPriceIsRightHardCutoffEnabled,
      maxTicketMemberIds: schema.alliances.trainPriceIsRightMaxTicketMemberIds,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const economySettings = normalizeTrainEconomyThresholdSettings({
    thresholdPoints: row?.thresholdPoints ?? null,
    fudgePct: row?.fudgePct ?? 1,
  });
  const ticketSettings = allianceRowToPriceIsRightSettings({
    trainPriceIsRightWeightingEnabled: row?.weightingEnabled,
    trainPriceIsRightHardCutoffEnabled: row?.hardCutoffEnabled,
    trainPriceIsRightMaxTicketMemberIds: row?.maxTicketMemberIds,
    trainEconomyThresholdPoints: economySettings.thresholdPoints,
  });

  return {
    ...economySettings,
    ...ticketSettings,
    canManage,
    effectiveCliffPoints: priceIsRightWeightingActive(ticketSettings)
      ? resolveCliffPoints(ticketSettings)
      : null,
  };
}

export async function saveTrainEconomyThreshold(
  allianceId: string,
  input: {
    thresholdPoints?: number | null;
    fudgePct?: number;
    weightingEnabled?: boolean;
    hardCutoffEnabled?: boolean;
    maxTicketMemberIds?: string[];
  },
): Promise<TrainEconomyThresholdRow> {
  const current = await loadTrainEconomyThreshold(allianceId, true);
  const economySettings = normalizeTrainEconomyThresholdSettings({
    thresholdPoints:
      input.thresholdPoints !== undefined
        ? input.thresholdPoints
        : current.thresholdPoints,
    fudgePct: input.fudgePct ?? current.fudgePct,
  });
  const ticketSettings = normalizePriceIsRightTicketSettings({
    weightingEnabled:
      input.weightingEnabled !== undefined
        ? input.weightingEnabled
        : current.weightingEnabled,
    cliffPoints: economySettings.thresholdPoints,
    hardCutoffEnabled:
      input.hardCutoffEnabled !== undefined
        ? input.hardCutoffEnabled
        : current.hardCutoffEnabled,
    maxTicketMemberIds:
      input.maxTicketMemberIds !== undefined
        ? input.maxTicketMemberIds
        : current.maxTicketMemberIds,
  });

  if (
    priceIsRightWeightingActive(ticketSettings) &&
    economySettings.thresholdPoints != null &&
    !isCliffValidForWeighting(economySettings.thresholdPoints)
  ) {
    throw new Error(
      `Cliff must be greater than ${PRICE_IS_RIGHT_MIN_VS_SCORE.toLocaleString()} VS.`,
    );
  }

  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainEconomyThresholdPoints: economySettings.thresholdPoints,
      trainEconomyThresholdFudgePct: economySettings.fudgePct,
      trainPriceIsRightWeightingEnabled: ticketSettings.weightingEnabled ? 1 : 0,
      trainPriceIsRightHardCutoffEnabled: ticketSettings.hardCutoffEnabled
        ? 1
        : 0,
      trainPriceIsRightMaxTicketMemberIds: ticketSettings.maxTicketMemberIds,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return loadTrainEconomyThreshold(allianceId, true);
}

export async function loadPriceIsRightTicketSettings(
  allianceId: string,
): Promise<PriceIsRightTicketSettings> {
  const row = await loadTrainEconomyThreshold(allianceId, false);
  return {
    weightingEnabled: row.weightingEnabled,
    cliffPoints: row.thresholdPoints,
    hardCutoffEnabled: row.hardCutoffEnabled,
    maxTicketMemberIds: row.maxTicketMemberIds,
  };
}

export async function filterPoolByEconomyThreshold(input: {
  allianceId: string;
  trainDate: string;
  candidates: RollCandidate[];
  settings?: TrainEconomyThresholdSettings;
}): Promise<RollCandidate[]> {
  const settings =
    input.settings ??
    (await loadTrainEconomyThreshold(input.allianceId, false));
  if (!economyThresholdEnforcementEnabled(settings)) {
    return input.candidates;
  }

  const scoreDate = vsScoreReferenceDate(input.trainDate);
  const vsScores = await fetchAlliancePriorDayVsScoresByMember(
    input.allianceId,
    scoreDate,
  );

  return tpirEligiblePoolEntries(input.candidates, vsScores, settings);
}

export async function buildPriceIsRightWeightedCandidates(input: {
  allianceId: string;
  trainDate: string;
  candidates: RollCandidate[];
  settings?: PriceIsRightTicketSettings;
  viewerMemberId?: string | null;
}): Promise<{
  candidates: RollCandidate[];
  board: PriceIsRightTicketBoardEntry[];
  missedFloor: PriceIsRightMissedFloorEntry[];
  scoreDate: string;
}> {
  const settings =
    input.settings ??
    (await loadPriceIsRightTicketSettings(input.allianceId));
  const scoreDate = vsScoreReferenceDate(input.trainDate);
  const vsScores = await fetchAlliancePriorDayVsScoresByMember(
    input.allianceId,
    scoreDate,
  );

  const { board, missedFloor } = buildPriceIsRightTicketBoard(
    input.candidates,
    vsScores,
    settings,
    input.viewerMemberId,
  );

  const boardByMember = new Map(board.map((entry) => [entry.memberId, entry]));
  const candidates = input.candidates.flatMap((candidate) => {
    const ticket = boardByMember.get(candidate.memberId);
    if (!ticket || ticket.ticketCount <= 0) return [];
    return [
      {
        ...candidate,
        ticketCount: ticket.ticketCount,
        priorDayVsScore: ticket.priorDayVsScore,
      },
    ];
  });

  return { candidates, board, missedFloor, scoreDate };
}
