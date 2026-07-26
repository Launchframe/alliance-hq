import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import type { MemberQualificationPayload } from "@/lib/trains/train-conductor-minimums.shared";
import { PRICE_IS_RIGHT_MIN_VS_SCORE } from "@/lib/trains/train-economy-threshold.shared";

export type WheelShareCandidate = {
  memberId: string;
  memberName: string;
  priorDayVsScore?: number;
  allianceRank?: number | null;
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
    }
  | {
      kind: "vs_leaderboard";
      score: number;
      suffix: "VS" | "VR";
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
  leaderboardRank?: number | null;
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

  if (isPriceIsRightPaintTemplate(input.paintTemplate) && score != null) {
    return {
      kind: "tpif",
      score,
      sweetSpot: PRICE_IS_RIGHT_MIN_VS_SCORE,
    };
  }

  const suffix = vsLeaderboardSuffix(input.mechanism);
  if (suffix && score != null) {
    return {
      kind: "vs_leaderboard",
      score,
      suffix,
      rank: input.leaderboardRank ?? input.winner.allianceRank ?? null,
    };
  }

  return null;
}

export type WheelShareEligibilityLabels = {
  vsMinimum: (score: string, minimum: string) => string;
  tpif: (score: string, sweetSpot: string) => string;
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
