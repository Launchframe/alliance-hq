import { z } from "zod";

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
]);

export type ConductorRule = z.infer<typeof conductorRuleSchema>;

export const vipRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("donations_second") }),
  z.object({
    kind: z.literal("event_top_x"),
    eventKey: z.string().min(1).max(64),
    topN: z.number().int().min(1).max(100),
  }),
  /** VIP intentionally skipped for this day (old `vip_mechanism = "none"`). */
  z.object({ kind: z.literal("none") }),
]);

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
  }
}

export function vipRuleIdentity(rule: VipRule | null): string {
  if (!rule) return "free_choice";
  if (rule.kind === "event_top_x") {
    return `event_top_x:${rule.eventKey}:${rule.topN}`;
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
  }
}

export function vipRuleLabelKey(rule: VipRule | null): string {
  if (!rule) return "vipConductorPick";
  switch (rule.kind) {
    case "donations_second":
      return "vipDonationsSecond";
    case "event_top_x":
      return "vipEventTopX";
    case "none":
      return "vipNone";
  }
}

export { VR_TOP_N_SCOPES, VS_TOP_N_SCOPES };
