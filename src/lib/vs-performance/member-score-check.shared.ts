import { vsTotalSchema } from "./match-results.shared";
import { VsPerformanceError } from "./weekly-plan.shared";

export type VsMemberScoreCheck = {
  status: "match" | "shortfall" | "excess" | "missing" | "unavailable";
  confirmedTotal: string;
  uploadedTotal: string | null;
  difference: string | null;
  memberCount: number;
};

export function compareVsMemberScores(confirmedTotal: string, scores: ReadonlyMap<string, number>): VsMemberScoreCheck {
  if (!vsTotalSchema.safeParse(confirmedTotal).success) throw new VsPerformanceError("invalidTotals");
  if (scores.size === 0) return { status: "missing", confirmedTotal, uploadedTotal: null, difference: null, memberCount: 0 };
  let uploaded = BigInt(0);
  for (const score of scores.values()) {
    if (!Number.isSafeInteger(score) || score < 0) throw new VsPerformanceError("invalid_snapshot", 422);
    uploaded += BigInt(score);
  }
  const difference = BigInt(confirmedTotal) - uploaded;
  return {
    status: difference === BigInt(0) ? "match" : difference > BigInt(0) ? "shortfall" : "excess",
    confirmedTotal,
    uploadedTotal: uploaded.toString(),
    difference: difference.toString(),
    memberCount: scores.size,
  };
}

export function unavailableVsMemberScoreCheck(confirmedTotal: string): VsMemberScoreCheck {
  if (!vsTotalSchema.safeParse(confirmedTotal).success) throw new VsPerformanceError("invalidTotals");
  return { status: "unavailable", confirmedTotal, uploadedTotal: null, difference: null, memberCount: 0 };
}

export function formatVsScoreDifference(value: string, locale: string): string {
  if (!/^-?(0|[1-9]\d*)$/.test(value)) throw new VsPerformanceError("invalidTotals");
  return new Intl.NumberFormat(locale, { signDisplay: "always" }).format(BigInt(value));
}
