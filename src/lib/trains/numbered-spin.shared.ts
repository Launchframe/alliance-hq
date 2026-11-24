import type {
  ConductorRule,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";
import type { TrainRollErrorDetails } from "@/lib/trains/roll-errors.shared";
import type { RollCandidate } from "@/lib/trains/types";

export const NUMBERED_SPIN_CANDIDATE_PREFIX = "numbered-rank:";

/**
 * Extract the pool size N for rules that support a 1..N numbered-spin fallback
 * when scores/evidence are not yet uploaded.
 *
 * Supported rules:
 * - `vs_top_n` (conductor or VIP)
 * - `vr_top_n` (conductor)
 * - `event_top_x` (conductor or VIP)
 * - `event_scores` with a numeric `topN` (conductor or VIP)
 *
 * Returns `null` for non-Top-N rules (rank pools, Price Is Freight, donations,
 * `vs_min_score`, `event_scores` with `topN: "all"`, `none`, or free choice).
 */
export function resolveNumberedSpinPoolSize(
  rule: ConductorRule | VipRule | null | undefined,
): number | null {
  if (!rule) return null;
  switch (rule.kind) {
    case "vs_top_n":
    case "vr_top_n":
    case "event_top_x":
      return Number.isInteger(rule.topN) && rule.topN >= 1 ? rule.topN : null;
    case "event_scores":
      return typeof rule.topN === "number" &&
        Number.isInteger(rule.topN) &&
        rule.topN >= 1
        ? rule.topN
        : null;
    default:
      return null;
  }
}

/**
 * True when a blocked wheel error is caused by missing scores or event
 * readiness AND the day's rule has a finite Top-N pool size for a 1..N draw.
 */
export function isNumberedSpinFallbackEligible(
  details: TrainRollErrorDetails | null | undefined,
  rule: ConductorRule | VipRule | null | undefined,
): boolean {
  if (!details) return false;
  if (resolveNumberedSpinPoolSize(rule) === null) return false;

  if (details.code === "NO_WHEEL_CANDIDATES") {
    if (details.spinBlockReason === "day_spin_exhausted") return false;
    return (
      details.candidateKind === "vs" ||
      details.candidateKind === "vr" ||
      details.candidateKind === "event"
    );
  }

  return (
    details.code === "EVENT_NOT_READY" ||
    details.code === "PENDING_EVIDENCE" ||
    details.code === "READINESS_INVALIDATED"
  );
}

/** Synthetic memberId for rank `k` (1-based) on the numbered wheel. */
export function numberedSpinCandidateId(rank: number): string {
  return `${NUMBERED_SPIN_CANDIDATE_PREFIX}${rank}`;
}

/** Build `#1..#N` wheel candidates so `ConductorWheelModal` can spin 1..N. */
export function buildNumberedWheelCandidates(
  poolSize: number,
): RollCandidate[] {
  if (!Number.isInteger(poolSize) || poolSize < 1) return [];
  return Array.from({ length: poolSize }, (_, idx) => {
    const rank = idx + 1;
    return {
      memberId: numberedSpinCandidateId(rank),
      memberName: `#${rank}`,
    };
  });
}

export type RankedScoreMember = {
  memberId: string;
  memberName: string;
};

/**
 * Resolve the member at 1-based `rank` from a sorted leaderboard.
 * When `excludeMemberId` is provided (e.g. VIP excludes the day's conductor),
 * that member is removed before indexing so rank #1 is the top non-conductor.
 */
export function resolveMemberAtNumberedRank<T extends RankedScoreMember>(
  rankedMembers: readonly T[],
  rank: number,
  excludeMemberId?: string | null,
): T | null {
  if (!Number.isInteger(rank) || rank < 1) return null;
  const filtered = excludeMemberId
    ? rankedMembers.filter((m) => m.memberId !== excludeMemberId)
    : rankedMembers;
  return filtered[rank - 1] ?? null;
}
