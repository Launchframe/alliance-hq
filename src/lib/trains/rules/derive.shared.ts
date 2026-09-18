import type { PoolType } from "@/lib/trains/types";
import { getServerDayOfWeek } from "@/lib/trains/game-time";
import {
  clampTrainConductorLeadTimeDays,
  vsScoreReferenceDate,
} from "@/lib/trains/vs-week-days.shared";
import type { ConductorRule, VipRule } from "@/lib/trains/rules/catalog.shared";

/**
 * Everything derived from a rule lives here: which day supplies its data,
 * whether it can be satisfied at all, what the wheel spins, and who is
 * eligible. Callers ask this module instead of re-deriving from mechanism
 * strings, paint templates, and weekday special cases.
 */

export type PoolSpinSource = { kind: "pool"; poolType: PoolType };
export type VsLeaderboardSpinSource = { kind: "vs_leaderboard"; topN: number };
export type VrLeaderboardSpinSource = { kind: "vr_leaderboard"; topN: number };
export type DonationsLeaderboardSpinSource = {
  kind: "donations_leaderboard";
  rank: 1 | 2;
};
export type EventLeaderboardSpinSource = { kind: "event_leaderboard" };
/** Price Is Freight weekday raffle — with replacement, not a depleting pool. */
export type PriceIsRightWeekdaySpinSource = { kind: "price_is_right_raffle" };
/** Price Is Freight max-ticket draw — with replacement, not a depleting pool. */
export type PriceIsRightHeavyHitterSpinSource = {
  kind: "price_is_right_heavy_hitter";
};

export type SpinSource =
  | PoolSpinSource
  | VsLeaderboardSpinSource
  | VrLeaderboardSpinSource
  | DonationsLeaderboardSpinSource
  | EventLeaderboardSpinSource
  | PriceIsRightWeekdaySpinSource
  | PriceIsRightHeavyHitterSpinSource
  | null;

/** Sunday is the VS break — no match scores are produced. */
export const VS_BREAK_DOW = 0;

export function isVsMatchDay(dow: number): boolean {
  return dow >= 1 && dow <= 6;
}

export type RuleSourceDay =
  /** Rule reads a specific calendar day's scores (VS, donations). */
  | { kind: "score_day"; date: string }
  /** Rule reads roster / season state — no per-day source. */
  | { kind: "none" };

/** True when the rule's data comes from a VS match day's scores. */
export function conductorRuleUsesVsScores(
  rule: ConductorRule | null,
): boolean {
  if (!rule) return false;
  return rule.kind === "vs_top_n" || rule.kind === "price_is_freight";
}

/** True when the rule reads the prior scoring day at all (VS or donations). */
export function conductorRuleUsesScoreDay(rule: ConductorRule | null): boolean {
  if (!rule) return false;
  return conductorRuleUsesVsScores(rule) || rule.kind === "donations_top";
}

/**
 * Which calendar day supplies this rule's data.
 *
 * Lead time shifts the source day, never the rule's slot: with lead 0 a train
 * day reads T−1, with lead 1 it reads T−2. See `vsScoreReferenceDate`.
 */
export function conductorRuleSourceDay(
  rule: ConductorRule | null,
  trainDate: string,
  leadDays = 0,
): RuleSourceDay {
  if (!conductorRuleUsesScoreDay(rule)) return { kind: "none" };
  return { kind: "score_day", date: vsScoreReferenceDate(trainDate, leadDays) };
}

export function vipRuleSourceDay(
  rule: VipRule | null,
  trainDate: string,
  leadDays = 0,
): RuleSourceDay {
  if (rule?.kind !== "donations_second") return { kind: "none" };
  return { kind: "score_day", date: vsScoreReferenceDate(trainDate, leadDays) };
}

export type RuleValidity =
  | { ok: true }
  | { ok: false; reason: "source_day_not_vs_day"; sourceDow: number };

/**
 * Can this rule be satisfied on this weekday, given the alliance's lead time?
 *
 * VS-sourced rules need their source day to be a VS match day. With lead 0 a
 * Monday train day reads Sunday and has no scores; with lead 1 the same gap
 * lands on Tuesday. This is computed, never encoded in a template name.
 *
 * Advisory only — officers may knowingly paint the day and pick manually.
 */
export function validateConductorRuleOnWeekday(
  rule: ConductorRule | null,
  trainDow: number,
  leadDays = 0,
): RuleValidity {
  if (!conductorRuleUsesVsScores(rule)) return { ok: true };
  const lead = clampTrainConductorLeadTimeDays(leadDays);
  const sourceDow = (((trainDow - 1 - lead) % 7) + 7) % 7;
  if (isVsMatchDay(sourceDow)) return { ok: true };
  return { ok: false, reason: "source_day_not_vs_day", sourceDow };
}

export function validateConductorRuleOnDate(
  rule: ConductorRule | null,
  trainDate: string,
  leadDays = 0,
): RuleValidity {
  return validateConductorRuleOnWeekday(
    rule,
    getServerDayOfWeek(trainDate),
    leadDays,
  );
}

export function spinSourceForConductorRule(
  rule: ConductorRule | null,
): SpinSource {
  if (!rule) return null;
  switch (rule.kind) {
    case "vs_top_n":
      return { kind: "vs_leaderboard", topN: rule.topN };
    case "vr_top_n":
      return { kind: "vr_leaderboard", topN: rule.topN };
    case "rank_pool":
      return { kind: "pool", poolType: rule.pool };
    case "price_is_freight":
      return rule.board === "heavy_hitter"
        ? { kind: "price_is_right_heavy_hitter" }
        : { kind: "price_is_right_raffle" };
    case "donations_top":
      return { kind: "donations_leaderboard", rank: 1 };
    case "event_top_x":
      return { kind: "pool", poolType: "event_top_x" };
  }
}

export function spinSourceForVipRule(rule: VipRule | null): SpinSource {
  if (!rule || rule.kind === "none") return null;
  if (rule.kind === "donations_second") {
    return { kind: "donations_leaderboard", rank: 2 };
  }
  return { kind: "pool", poolType: "event_top_x" };
}

/** Depleting pool backing this rule, when it has one. */
export function conductorRulePoolType(
  rule: ConductorRule | null,
): PoolType | null {
  if (!rule) return null;
  if (rule.kind === "rank_pool") return rule.pool;
  if (rule.kind === "event_top_x") return "event_top_x";
  return null;
}

export function vipRulePoolType(rule: VipRule | null): PoolType | null {
  return rule?.kind === "event_top_x" ? "event_top_x" : null;
}

/**
 * Price Is Freight draws with replacement — they never seed, mark, or reseed
 * `conductor_pool_entries`, unlike the depleting rank pools.
 */
export function conductorRuleUsesPriceIsFreightRoll(
  rule: ConductorRule | null,
): boolean {
  return rule?.kind === "price_is_freight";
}

/** Conductor VS/donation minimums apply to Price Is Freight paints only. */
export function conductorRuleAppliesMinimums(
  rule: ConductorRule | null,
): boolean {
  return conductorRuleUsesPriceIsFreightRoll(rule);
}

/** Top VS / VR scope 1 resolves to a single member — assigned, not spun. */
export function conductorRuleIsAutomatic(rule: ConductorRule | null): boolean {
  if (!rule) return false;
  if (rule.kind === "donations_top") return true;
  return (
    (rule.kind === "vs_top_n" || rule.kind === "vr_top_n") && rule.topN === 1
  );
}

export function conductorRuleNeedsWheel(rule: ConductorRule | null): boolean {
  if (!rule) return false;
  if (conductorRuleIsAutomatic(rule)) return false;
  // R3 recognition is a manual award pick from the pool — no wheel.
  if (rule.kind === "rank_pool" && rule.draw === "manual") return false;
  return true;
}

export function canSpinConductorForRule(
  rule: ConductorRule | null,
  locked: boolean,
): boolean {
  if (locked) return false;
  return conductorRuleNeedsWheel(rule);
}

/** VIP boards after the conductor is locked / spawned in game. */
export function canSpinVipForRule(
  rule: VipRule | null,
  locked: boolean,
): boolean {
  if (!locked || !rule || rule.kind === "none") return false;
  return rule.kind === "donations_second" || rule.kind === "event_top_x";
}

/** Officer manual VIP / Guardian pick — open roster assign unless skipped. */
export function supportsManualVipPickForRule(rule: VipRule | null): boolean {
  return rule?.kind !== "none";
}

function rankEligibleForPool(pool: string, rank: number | null): boolean {
  if (pool === "heavy_hitter") return true;
  if (rank == null) return false;
  if (pool === "r3") return rank === 3;
  if (pool === "r4_plus") return rank >= 4;
  return false;
}

/**
 * Paint-time eligibility: may we keep an assigned conductor when the day's
 * rule changes?
 *
 * **Fail open.** Only rank is checked, and only when rank *is* the rule. A
 * leaderboard we cannot see (VS / VR / event / max-ticket list) must never
 * produce a false "this member is ineligible" gate — that regression pulled a
 * valid on-roster conductor off the day. Spin time still enforces the board.
 */
export function isMemberEligibleForConductorRule(input: {
  memberId: string | null | undefined;
  onRoster: boolean;
  allianceRank: number | null | undefined;
  rule: ConductorRule | null;
}): boolean {
  if (!input.memberId || !input.onRoster) return false;
  const rule = input.rule;
  if (!rule) return true;
  if (rule.kind === "rank_pool") {
    return rankEligibleForPool(rule.pool, input.allianceRank ?? null);
  }
  // R3 membership is part of the weekday raffle rule itself.
  if (rule.kind === "price_is_freight" && rule.board === "weekday") {
    return rankEligibleForPool("r3", input.allianceRank ?? null);
  }
  return true;
}

export function isPoolSpinSource(source: SpinSource): source is PoolSpinSource {
  return source?.kind === "pool";
}

export function isPriceIsRightSpinSource(
  source: SpinSource,
): source is PriceIsRightWeekdaySpinSource | PriceIsRightHeavyHitterSpinSource {
  return (
    source?.kind === "price_is_right_raffle" ||
    source?.kind === "price_is_right_heavy_hitter"
  );
}
