import { z } from "zod";

import {
  EVENT_FAMILY_POLICY,
  EVENT_TARGETS,
  EVENT_TEAM_SCOPES,
} from "@/lib/hq-events/event-types.shared";
import {
  VR_TOP_N_SCOPES,
  VS_TOP_N_SCOPES,
} from "@/lib/trains/conductor-top-n.shared";

/**
 * Typed conductor / VIP rules.
 *
 * One rule fully describes how a day's conductor (or VIP) is chosen. It
 * replaces the old triple of `conductor_mechanism` + `conductor_config.
 * paintTemplate` + `conductor_config.topN`, which required every caller to
 * reconcile three vocabularies before it could answer "what happens today".
 *
 * `null` means **free choice** — no rule, an officer assigns whoever they want.
 */

export const CONDUCTOR_RULE_KINDS = [
  "vs_top_n",
  "vr_top_n",
  "rank_pool",
  "price_is_freight",
  "donations_top",
  "event_top_x",
  "event_scores",
] as const;

export type ConductorRuleKind = (typeof CONDUCTOR_RULE_KINDS)[number];

/**
 * Depleting pools a conductor rule can draw from. `all_members` exists as a
 * `PoolType` for pool summaries but no rule draws from it.
 */
export const RANK_POOLS = ["r3", "r4_plus", "heavy_hitter"] as const;

export type RankPool = (typeof RANK_POOLS)[number];

/** `wheel` spins the pool; `manual` is an officer award pick (R3 recognition). */
export const RANK_POOL_DRAWS = ["wheel", "manual"] as const;

export type RankPoolDraw = (typeof RANK_POOL_DRAWS)[number];

/** Weekday raffle vs Saturday max-ticket draw — both with replacement. */
export const PRICE_IS_FREIGHT_BOARDS = ["weekday", "heavy_hitter"] as const;

export type PriceIsFreightBoard = (typeof PRICE_IS_FREIGHT_BOARDS)[number];

/**
 * Reviewed-event scopes. `all` is the participation board (leaderboard
 * members plus, for participants rules, Yes respondents); numeric scopes
 * rank only real scores — poll credits never fill slots.
 */
export const EVENT_SCORE_SCOPES = [1, 3, 5, 10, "all"] as const;

export type EventScoreScope = (typeof EVENT_SCORE_SCOPES)[number];

export const eventScoresSourceSchema = z.object({
  target: z.enum(EVENT_TARGETS),
  seriesId: z.string().max(128).nullable(),
  occurrenceId: z.string().max(128).nullable(),
  boardKey: z.string().max(128).nullable(),
  teamScope: z.enum(EVENT_TEAM_SCOPES).nullable(),
});

const eventScoresRuleShape = z.object({
  kind: z.literal("event_scores"),
  source: eventScoresSourceSchema.strict(),
  eligibility: z.enum(["scored", "participants"]),
  topN: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(5),
    z.literal(10),
    z.literal("all"),
  ]),
  fallback: z.enum(["none", "confirmed_poll_yes"]),
}).strict();

export type EventScoresRule = z.infer<typeof eventScoresRuleShape>;

/**
 * Cross-field policy on an `event_scores` rule, shared by conductor and VIP:
 * participants mode is Warzone-only with `all` scope and no fallback; the
 * confirmed-empty poll fallback is a Warzone scored rule only; Storm targets
 * require a team scope and no other family carries one.
 */
function validateEventScoresRule(
  rule: { kind: string },
  ctx: z.RefinementCtx,
): void {
  if (rule.kind !== "event_scores") return;
  const eventRule = rule as EventScoresRule;
  const policy = EVENT_FAMILY_POLICY[eventRule.source.target];
  if (policy.teamScoped && eventRule.source.teamScope == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "storm targets require teamScope A, B, or both",
      path: ["source", "teamScope"],
    });
  }
  if (!policy.teamScoped && eventRule.source.teamScope != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "teamScope applies only to storm events",
      path: ["source", "teamScope"],
    });
  }
  if (eventRule.eligibility === "participants") {
    if (
      eventRule.source.target !== "warzone-duel" ||
      eventRule.topN !== "all" ||
      eventRule.fallback !== "none"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "participants mode requires the warzone-duel target, topN 'all', and fallback 'none'",
      });
    }
  }
  if (
    eventRule.fallback === "confirmed_poll_yes" &&
    (eventRule.source.target !== "warzone-duel" ||
      eventRule.eligibility !== "scored")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "confirmed_poll_yes fallback requires the warzone-duel target and scored eligibility",
      path: ["fallback"],
    });
  }
}

export const conductorRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("vs_top_n"),
    topN: z.union([
      z.literal(1),
      z.literal(3),
      z.literal(5),
      z.literal(10),
    ]),
  }),
  z.object({
    kind: z.literal("vr_top_n"),
    topN: z.union([z.literal(3), z.literal(5), z.literal(10)]),
  }),
  z.object({
    kind: z.literal("rank_pool"),
    pool: z.enum(RANK_POOLS),
    draw: z.enum(RANK_POOL_DRAWS),
  }),
  z.object({
    kind: z.literal("price_is_freight"),
    board: z.enum(PRICE_IS_FREIGHT_BOARDS),
  }),
  z.object({ kind: z.literal("donations_top") }),
  z.object({
    kind: z.literal("event_top_x"),
    eventKey: z.string().min(1).max(64),
    topN: z.number().int().min(1).max(100),
  }),
  eventScoresRuleShape,
]).superRefine(validateEventScoresRule);

export type ConductorRule = z.infer<typeof conductorRuleSchema>;

export const vipRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("donations_second") }),
  z.object({
    kind: z.literal("event_top_x"),
    eventKey: z.string().min(1).max(64),
    topN: z.number().int().min(1).max(100),
  }),
  eventScoresRuleShape,
  /** VIP intentionally skipped for this day (old `vip_mechanism = "none"`). */
  z.object({ kind: z.literal("none") }),
]).superRefine((rule, ctx) => {
  validateEventScoresRule(rule, ctx);
  if (
    rule.kind === "event_scores" &&
    (rule as EventScoresRule).fallback !== "none"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "poll fallback is a scored conductor rule only",
      path: ["fallback"],
    });
  }
});

export type VipRule = z.infer<typeof vipRuleSchema>;

/** `null` = free choice: the officer (conductor, for VIP) picks anyone. */
export const nullableConductorRuleSchema = conductorRuleSchema.nullable();
export const nullableVipRuleSchema = vipRuleSchema.nullable();

export type DayRules = {
  conductorRule: ConductorRule | null;
  vipRule: VipRule | null;
};

export const dayRulesSchema = z.object({
  conductorRule: nullableConductorRuleSchema,
  vipRule: nullableVipRuleSchema,
});

export const FREE_CHOICE_DAY_RULES: DayRules = {
  conductorRule: null,
  vipRule: null,
};

export type DayRulePatch = {
  conductorRule?: ConductorRule | null;
  vipRule?: VipRule | null;
};

export function mergeDayRulePatch(
  current: DayRules,
  patch: DayRulePatch,
): DayRules {
  return {
    conductorRule:
      patch.conductorRule === undefined
        ? current.conductorRule
        : patch.conductorRule,
    vipRule: patch.vipRule === undefined ? current.vipRule : patch.vipRule,
  };
}

export function parseConductorRule(value: unknown): ConductorRule | null {
  if (value == null) return null;
  const parsed = conductorRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseVipRule(value: unknown): VipRule | null {
  if (value == null) return null;
  const parsed = vipRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Stable identity for "did this day's draw change".
 * Replaces `conductorDrawIdentity`, which had to merge mechanism, paint
 * template, and topN and still reported false changes between the two
 * encodings of Top 10 VS.
 */
export function conductorRuleIdentity(rule: ConductorRule | null): string {
  if (!rule) return "free_choice";
  switch (rule.kind) {
    case "vs_top_n":
    case "vr_top_n":
      return `${rule.kind}:${rule.topN}`;
    case "rank_pool":
      return `rank_pool:${rule.pool}:${rule.draw}`;
    case "price_is_freight":
      return `price_is_freight:${rule.board}`;
    case "donations_top":
      return "donations_top";
    case "event_top_x":
      return `event_top_x:${rule.eventKey}:${rule.topN}`;
    case "event_scores":
      return eventScoresRuleIdentity(rule);
  }
}

/**
 * Event rule identity covers every source and policy field — a different
 * occurrence, board, team, eligibility mode, scope or fallback is a
 * different rule, never "the same event".
 */
function eventScoresRuleIdentity(rule: EventScoresRule): string {
  const source = rule.source;
  const parts = [
    source.target,
    source.seriesId ?? "",
    source.occurrenceId ?? "",
    source.boardKey ?? "",
    source.teamScope ?? "",
    rule.eligibility,
    String(rule.topN),
    rule.fallback,
  ];
  return `event_scores:${parts.join(":")}`;
}

export function vipRuleIdentity(rule: VipRule | null): string {
  if (!rule) return "free_choice";
  if (rule.kind === "event_top_x") {
    return `event_top_x:${rule.eventKey}:${rule.topN}`;
  }
  if (rule.kind === "event_scores") {
    return eventScoresRuleIdentity(rule);
  }
  return rule.kind;
}

export function conductorRuleChanged(
  before: ConductorRule | null,
  after: ConductorRule | null,
): boolean {
  return conductorRuleIdentity(before) !== conductorRuleIdentity(after);
}

/** i18n key suffix under `trains.rules.*` for labels and cell text. */
export function conductorRuleLabelKey(rule: ConductorRule | null): string {
  if (!rule) return "freeChoice";
  switch (rule.kind) {
    case "vs_top_n":
      return rule.topN === 1 ? "vsTop1" : "vsTopN";
    case "vr_top_n":
      return "vrTopN";
    case "rank_pool":
      if (rule.pool === "r3") {
        return rule.draw === "manual" ? "r3Award" : "r3Lottery";
      }
      return rule.pool === "r4_plus" ? "r4Rotation" : "heavyHitterPool";
    case "price_is_freight":
      return rule.board === "heavy_hitter"
        ? "priceIsFreightHeavyHitter"
        : "priceIsFreightWeekday";
    case "donations_top":
      return "donationsTop";
    case "event_top_x":
      return "eventTopX";
    case "event_scores":
      return "eventScores";
  }
}

export function vipRuleLabelKey(rule: VipRule | null): string {
  if (!rule) return "vipConductorPick";
  switch (rule.kind) {
    case "donations_second":
      return "vipDonationsSecond";
    case "event_top_x":
      return "vipEventTopX";
    case "event_scores":
      return "eventScores";
    case "none":
      return "vipNone";
  }
}

/**
 * Label key that resolves outside `trains.rules`: `event_scores` reuses the
 * approved `eventEvidence.title` copy instead of a duplicated rules entry.
 */
export const EVENT_SCORES_LABEL_KEY = "eventScores";

type RuleLabelTranslate = (key: string) => string;

/** Resolve a rule label key, routing `eventScores` to `eventEvidence.title`. */
export function ruleLabelText(
  labelKey: string,
  tRules: RuleLabelTranslate,
  tEventEvidence: RuleLabelTranslate,
): string {
  return labelKey === EVENT_SCORES_LABEL_KEY
    ? tEventEvidence("title")
    : tRules(labelKey);
}

export { VR_TOP_N_SCOPES, VS_TOP_N_SCOPES };
