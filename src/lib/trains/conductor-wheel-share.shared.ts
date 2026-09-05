import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";
import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";

export type WheelShareCandidate = {
  memberId: string;
  memberName: string;
  priorDayVsScore?: number;
  /** Ticket weight when the draw was a Price Is Freight raffle. */
  ticketCount?: number;
  winProbability?: number;
};

export type WheelShareEligibility =
  | {
      kind: "vs_minimum";
      score: number;
      minimum: number;
    }
  | {
      kind: "tpif";
      score: number;
      sweetSpot: number;
      /** Raffle win chance in [0, 1] when ticket weighting applies. */
      winProbability?: number | null;
    }
  | {
      kind: "vs_leaderboard";
      score: number;
      suffix: "VS" | "VR";
      /** Rank among alliance scoreboard entries (1-based), not alliance R-rank. */
      rank: number | null;
    }
  | null;

export function formatWheelShareScore(
  score: number,
  locale = "en-US",
): string {
  if (score >= 1_000_000) {
    const millions = score / 1_000_000;
    return Number.isInteger(millions)
      ? `${millions}M`
      : `${millions.toFixed(1)}M`;
  }
  if (score >= 1_000) return `${Math.round(score / 1_000)}K`;
  return score.toLocaleString(locale);
}

export function formatWheelSharePoints(
  score: number,
  locale = "en-US",
): string {
  return `${formatWheelShareScore(score, locale)} pts`;
}

export function formatWheelShareWinChance(
  winProbability: number,
  locale = "en-US",
): string {
  if (!Number.isFinite(winProbability) || winProbability <= 0) {
    return (0).toLocaleString(locale, {
      style: "percent",
      maximumFractionDigits: 2,
    });
  }
  const digits = winProbability >= 0.01 ? 1 : 2;
  return winProbability.toLocaleString(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function vsLeaderboardSuffix(
  mechanism: string | null | undefined,
): "VS" | "VR" | null {
  if (
    mechanism === "vs_top_10" ||
    mechanism === "vs_high_score" ||
    mechanism === "vs_top_n"
  ) {
    return "VS";
  }
  if (mechanism === "vr_top_n") return "VR";
  return null;
}

export function resolveWheelShareEligibility(input: {
  mechanism: string | null | undefined;
  paintTemplate: string | null | undefined;
  winner: WheelShareCandidate;
  qualification?: MemberQualificationPayload | null;
  /** Explicit scoreboard rank among alliance VS/VR scores (1-based). */
  leaderboardRank?: number | null;
  winProbability?: number | null;
}): WheelShareEligibility {
  const score =
    input.winner.priorDayVsScore != null && input.winner.priorDayVsScore > 0
      ? input.winner.priorDayVsScore
      : input.qualification?.vs.score != null &&
          input.qualification.vs.score > 0
        ? input.qualification.vs.score
        : null;

  if (
    input.qualification?.vs.minimum != null &&
    input.qualification.vs.minimum > 0 &&
    input.qualification.qualified
  ) {
    return {
      kind: "vs_minimum",
      score: input.qualification.vs.score,
      minimum: input.qualification.vs.effectiveMinimum,
    };
  }

  const winProbability =
    input.winProbability ??
    input.winner.winProbability ??
    null;

  if (isPriceIsRightPaintTemplate(input.paintTemplate) && score != null) {
    return {
      kind: "tpif",
      score,
      sweetSpot: PRICE_IS_RIGHT_MIN_VS_SCORE,
      winProbability:
        winProbability != null && Number.isFinite(winProbability)
          ? winProbability
          : null,
    };
  }

  const suffix = vsLeaderboardSuffix(input.mechanism);
  if (suffix && score != null) {
    return {
      kind: "vs_leaderboard",
      score,
      suffix,
      rank:
        input.leaderboardRank != null && input.leaderboardRank >= 1
          ? input.leaderboardRank
          : null,
    };
  }

  return null;
}

export type WheelShareEligibilityLabels = {
  vsMinimum: (score: string, minimum: string) => string;
  tpif: (score: string, sweetSpot: string) => string;
  tpifWithChance: (score: string, chance: string) => string;
  vsLeaderboardRank: (rank: number, score: string, suffix: string) => string;
  vsLeaderboardScore: (score: string, suffix: string) => string;
};

export function formatWheelShareEligibilityLine(
  eligibility: WheelShareEligibility,
  labels: WheelShareEligibilityLabels,
  locale = "en-US",
): string | null {
  if (!eligibility) return null;
  switch (eligibility.kind) {
    case "vs_minimum":
      return labels.vsMinimum(
        formatWheelSharePoints(eligibility.score, locale),
        formatWheelSharePoints(eligibility.minimum, locale),
      );
    case "tpif":
      if (
        eligibility.winProbability != null &&
        eligibility.winProbability > 0
      ) {
        return labels.tpifWithChance(
          formatWheelSharePoints(eligibility.score, locale),
          formatWheelShareWinChance(eligibility.winProbability, locale),
        );
      }
      return labels.tpif(
        formatWheelSharePoints(eligibility.score, locale),
        formatWheelSharePoints(eligibility.sweetSpot, locale),
      );
    case "vs_leaderboard":
      if (eligibility.rank != null && eligibility.rank >= 1) {
        return labels.vsLeaderboardRank(
          eligibility.rank,
          formatWheelShareScore(eligibility.score, locale),
          eligibility.suffix,
        );
      }
      return labels.vsLeaderboardScore(
        formatWheelShareScore(eligibility.score, locale),
        eligibility.suffix,
      );
    default:
      return null;
  }
}

/** Derive raffle win chance from ticket weights on the drawn pool. */
export function winProbabilityFromTicketPool(
  candidates: ReadonlyArray<{ memberId: string; ticketCount?: number }>,
  winnerMemberId: string,
): number | null {
  const total = candidates.reduce(
    (sum, row) => sum + Math.max(0, row.ticketCount ?? 0),
    0,
  );
  if (total <= 0) return null;
  const winner = candidates.find((row) => row.memberId === winnerMemberId);
  const tickets = winner?.ticketCount ?? 0;
  if (tickets <= 0) return null;
  return tickets / total;
}
