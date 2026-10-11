import type { VipRule } from "@/lib/trains/rules/catalog.shared";
import type { RollCandidate } from "@/lib/trains/types";

type VipVsRule = Extract<VipRule, { kind: "vs_top_n" | "vs_min_score" }>;

/**
 * VIP candidates from the prior-day VS board (sorted high → low). The day's
 * conductor never counts toward Top N, so Top 1 is the best non-conductor.
 * Members on time off are dropped after scoping, matching conductor spins.
 */
export function selectVipVsCandidates(input: {
  board: readonly RollCandidate[];
  rule: VipVsRule;
  conductorMemberId: string | null | undefined;
  awayMemberIds?: ReadonlySet<string>;
}): { scoped: RollCandidate[]; available: RollCandidate[] } {
  const others = input.board.filter(
    (candidate) => candidate.memberId !== input.conductorMemberId,
  );
  const rule = input.rule;
  const scoped =
    rule.kind === "vs_top_n"
      ? others.slice(0, rule.topN)
      : others.filter(
          (candidate) => (candidate.priorDayVsScore ?? 0) > rule.minScore,
        );
  const away = input.awayMemberIds;
  const available = away
    ? scoped.filter((candidate) => !away.has(candidate.memberId))
    : scoped;
  return { scoped, available };
}
