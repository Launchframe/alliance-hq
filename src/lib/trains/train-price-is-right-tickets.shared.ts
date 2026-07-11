import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";

/** Default decay cliff when ticket weighting is on and officer has not set a value. */
export const PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS = 9_000_000;

/** Fixed max tickets per member in the weighted raffle. */
export const PRICE_IS_RIGHT_MAX_TICKETS = 1024;

/** Decay steepness in normalized score t ∈ [0, 1]. */
export const PRICE_IS_RIGHT_DECAY_K = 4.6;

export type PriceIsRightTicketSettings = {
  weightingEnabled: boolean;
  cliffPoints: number | null;
  hardCutoffEnabled: boolean;
  maxTicketMemberIds: string[];
};

export type PriceIsRightTicketBoardEntry = {
  memberId: string;
  memberName: string;
  priorDayVsScore: number;
  ticketCount: number;
  winProbability: number;
  isTakedownOverride: boolean;
  isViewer?: boolean;
};

export type PriceIsRightMissedFloorEntry = {
  memberId: string;
  memberName: string;
  priorDayVsScore: number;
  isViewer?: boolean;
};

export type PriceIsRightTicketBoardResult = {
  board: PriceIsRightTicketBoardEntry[];
  missedFloor: PriceIsRightMissedFloorEntry[];
};

export type PriceIsRightChartPoint = {
  score: number;
  tickets: number;
  winProbability: number;
  memberName?: string;
  memberId?: string;
  isTakedownOverride?: boolean;
  isViewer?: boolean;
};

export type PriceIsRightTicketCandidate = {
  memberId: string;
  memberName: string;
};

export function priceIsRightWeightingActive(
  settings: PriceIsRightTicketSettings,
): boolean {
  return settings.weightingEnabled;
}

export function resolveCliffPoints(settings: PriceIsRightTicketSettings): number {
  if (settings.cliffPoints != null && settings.cliffPoints > 0) {
    return settings.cliffPoints;
  }
  return PRICE_IS_RIGHT_DEFAULT_CLIFF_POINTS;
}

export function normalizeMaxTicketMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || ids.includes(trimmed)) continue;
    ids.push(trimmed);
  }
  return ids;
}

export function normalizePriceIsRightTicketSettings(input: {
  weightingEnabled?: boolean | number | null;
  cliffPoints?: number | null;
  hardCutoffEnabled?: boolean | number | null;
  maxTicketMemberIds?: unknown;
}): PriceIsRightTicketSettings {
  return {
    weightingEnabled: input.weightingEnabled === true || input.weightingEnabled === 1,
    cliffPoints:
      input.cliffPoints != null &&
      Number.isFinite(input.cliffPoints) &&
      Math.trunc(input.cliffPoints) > 0
        ? Math.trunc(input.cliffPoints)
        : null,
    hardCutoffEnabled:
      input.hardCutoffEnabled === true || input.hardCutoffEnabled === 1,
    maxTicketMemberIds: normalizeMaxTicketMemberIds(input.maxTicketMemberIds),
  };
}

export function isCliffValidForWeighting(cliffPoints: number): boolean {
  return cliffPoints > PRICE_IS_RIGHT_MIN_VS_SCORE;
}

export function computeMemberTicketCount(
  priorDayVsScore: number,
  memberId: string,
  settings: PriceIsRightTicketSettings,
): number {
  if (!settings.weightingEnabled) return 0;
  if (priorDayVsScore < PRICE_IS_RIGHT_MIN_VS_SCORE) return 0;

  if (settings.maxTicketMemberIds.includes(memberId)) {
    return PRICE_IS_RIGHT_MAX_TICKETS;
  }

  const cliff = resolveCliffPoints(settings);
  if (settings.hardCutoffEnabled && priorDayVsScore > cliff) {
    return 0;
  }

  const span = Math.max(cliff - PRICE_IS_RIGHT_MIN_VS_SCORE, 1);
  const t = (priorDayVsScore - PRICE_IS_RIGHT_MIN_VS_SCORE) / span;
  const raw = PRICE_IS_RIGHT_MAX_TICKETS * Math.exp(-PRICE_IS_RIGHT_DECAY_K * t);
  return Math.max(1, Math.floor(raw));
}

export function buildPriceIsRightTicketBoard(
  candidates: PriceIsRightTicketCandidate[],
  vsScores: Map<string, number>,
  settings: PriceIsRightTicketSettings,
  viewerMemberId?: string | null,
): PriceIsRightTicketBoardResult {
  const entries = candidates.map((candidate) => {
    const priorDayVsScore = vsScores.get(candidate.memberId) ?? 0;
    const isTakedownOverride = settings.maxTicketMemberIds.includes(
      candidate.memberId,
    );
    const ticketCount = computeMemberTicketCount(
      priorDayVsScore,
      candidate.memberId,
      settings,
    );
    return {
      memberId: candidate.memberId,
      memberName: candidate.memberName,
      priorDayVsScore,
      ticketCount,
      winProbability: 0,
      isTakedownOverride,
      isViewer: viewerMemberId === candidate.memberId,
    };
  });

  const missedFloor = entries
    .filter(
      (entry) =>
        entry.priorDayVsScore > 0 &&
        entry.priorDayVsScore < PRICE_IS_RIGHT_MIN_VS_SCORE,
    )
    .map(({ memberId, memberName, priorDayVsScore, isViewer }) => ({
      memberId,
      memberName,
      priorDayVsScore,
      isViewer,
    }))
    .sort((a, b) => {
      if (b.priorDayVsScore !== a.priorDayVsScore) {
        return b.priorDayVsScore - a.priorDayVsScore;
      }
      return a.memberName.localeCompare(b.memberName);
    });

  const atOrAboveFloor = entries.filter(
    (entry) => entry.priorDayVsScore >= PRICE_IS_RIGHT_MIN_VS_SCORE,
  );
  const ticketPool = atOrAboveFloor.filter((entry) => entry.ticketCount > 0);
  const totalTickets = ticketPool.reduce(
    (sum, entry) => sum + entry.ticketCount,
    0,
  );
  const board = atOrAboveFloor
    .map((entry) => ({
      ...entry,
      winProbability:
        entry.ticketCount > 0 && totalTickets > 0
          ? entry.ticketCount / totalTickets
          : 0,
    }))
    .sort((a, b) => {
      if (b.ticketCount !== a.ticketCount) {
        return b.ticketCount - a.ticketCount;
      }
      return a.memberName.localeCompare(b.memberName);
    });

  return { board, missedFloor };
}

export function computeWinProbabilities(
  board: Array<Pick<PriceIsRightTicketBoardEntry, "ticketCount">>,
): number[] {
  const total = board.reduce((sum, entry) => sum + entry.ticketCount, 0);
  if (total <= 0) return board.map(() => 0);
  return board.map((entry) => entry.ticketCount / total);
}

export function samplePriceIsRightTicketCurve(
  settings: PriceIsRightTicketSettings,
  pointCount = 48,
): PriceIsRightChartPoint[] {
  if (!settings.weightingEnabled || pointCount < 2) return [];

  const cliff = resolveCliffPoints(settings);
  const min = PRICE_IS_RIGHT_MIN_VS_SCORE;
  const max =
    settings.hardCutoffEnabled
      ? cliff
      : Math.floor(cliff + (cliff - min) * 0.15);
  const span = Math.max(max - min, 1);
  const theoreticalBoard = Array.from({ length: pointCount }, (_, index) => {
    const score = Math.round(min + (index / (pointCount - 1)) * span);
    const ticketCount = computeMemberTicketCount(score, "__theoretical__", {
      ...settings,
      maxTicketMemberIds: [],
    });
    return { score, ticketCount };
  }).filter((point) => point.ticketCount > 0);

  const totalTickets = theoreticalBoard.reduce(
    (sum, point) => sum + point.ticketCount,
    0,
  );

  return theoreticalBoard.map((point) => ({
    score: point.score,
    tickets: point.ticketCount,
    winProbability:
      totalTickets > 0 ? point.ticketCount / totalTickets : 0,
  }));
}

export function boardToChartPoints(
  board: PriceIsRightTicketBoardEntry[],
): PriceIsRightChartPoint[] {
  return board.map((entry) => ({
    score: entry.priorDayVsScore,
    tickets: entry.ticketCount,
    winProbability: entry.winProbability,
    memberName: entry.memberName,
    memberId: entry.memberId,
    isTakedownOverride: entry.isTakedownOverride,
    isViewer: entry.isViewer,
  }));
}

export function formatPriceIsRightVsScore(score: number): string {
  if (Math.abs(score) >= 1_000_000) {
    const millions = score / 1_000_000;
    return Number.isInteger(millions)
      ? `${millions}M`
      : `${millions.toFixed(1)}M`;
  }
  if (Math.abs(score) >= 1_000) {
    return `${Math.round(score / 1_000)}K`;
  }
  return String(score);
}
