import { getServerDayOfWeek } from "@/lib/trains/game-time";
import type {
  ConductorRule,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * Legacy vocabulary codec.
 *
 * `decodeConductorRule` is the TypeScript twin of the SQL backfill in
 * `drizzle/0177_train_day_rules.sql`. The parity test in
 * `encode.shared.test.ts` is the contract both sides must satisfy — change
 * one and you must change the other.
 *
 * `encodeLegacyConductorMechanism` stays in use after the migration because
 * `train_conductor_records` keeps its mechanism columns as permanent history.
 */

export type LegacyConductorInput = {
  mechanism: string | null | undefined;
  paintTemplate?: string | null;
  topN?: number | null;
  /** Needed for legacy whole-week `price_is_right`, whose Saturday differs. */
  date?: string | null;
};

const VS_TOP_N_VALUES = [1, 3, 5, 10];
const VR_TOP_N_VALUES = [3, 5, 10];

function vsTopN(value: number | null | undefined): 1 | 3 | 5 | 10 {
  if (value != null && VS_TOP_N_VALUES.includes(value)) {
    return value as 1 | 3 | 5 | 10;
  }
  return 10;
}

function vrTopN(value: number | null | undefined): 3 | 5 | 10 {
  if (value != null && VR_TOP_N_VALUES.includes(value)) {
    return value as 3 | 5 | 10;
  }
  return 3;
}

function isPriceIsFreightPaint(paintTemplate: string | null | undefined) {
  return (
    paintTemplate === "price_is_right" ||
    paintTemplate === "price_is_right_weekdays" ||
    paintTemplate === "takedown_week"
  );
}

/**
 * Legacy whole-week `price_is_right` paint drew the max-ticket list on
 * Saturday and the weekday raffle otherwise; `takedown_week` was always the
 * max-ticket draw.
 */
function priceIsFreightBoard(
  paintTemplate: string | null | undefined,
  date: string | null | undefined,
): "weekday" | "heavy_hitter" {
  if (paintTemplate === "takedown_week") return "heavy_hitter";
  if (paintTemplate === "price_is_right" && date) {
    return getServerDayOfWeek(date) === 6 ? "heavy_hitter" : "weekday";
  }
  return "weekday";
}

export function decodeConductorRule(
  input: LegacyConductorInput,
): ConductorRule | null {
  const { mechanism, paintTemplate, topN, date } = input;

  // Paint template wins: it is what the roll path actually keyed on.
  if (isPriceIsFreightPaint(paintTemplate)) {
    return {
      kind: "price_is_freight",
      board: priceIsFreightBoard(paintTemplate, date),
    };
  }
  if (paintTemplate === "r4_event_vip") {
    return { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };
  }
  if (paintTemplate === "top_vs") {
    return { kind: "vs_top_n", topN: vsTopN(topN) };
  }
  if (paintTemplate === "top_vr") {
    return { kind: "vr_top_n", topN: vrTopN(topN) };
  }
  if (paintTemplate === "r3_recognition") {
    return { kind: "rank_pool", pool: "r3", draw: "manual" };
  }
  if (paintTemplate === "economy_week") {
    return { kind: "rank_pool", pool: "r3", draw: "wheel" };
  }

  switch (mechanism) {
    case "vs_high_score":
      return { kind: "vs_top_n", topN: 1 };
    case "vs_top_10":
      return { kind: "vs_top_n", topN: 10 };
    case "vs_top_n":
      return { kind: "vs_top_n", topN: vsTopN(topN) };
    case "vr_top_n":
      return { kind: "vr_top_n", topN: vrTopN(topN) };
    case "r3_lottery":
      return { kind: "rank_pool", pool: "r3", draw: "wheel" };
    case "heavy_hitter_lottery":
      return { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" };
    case "r4_sequence":
      return { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };
    case "donations_top":
      return { kind: "donations_top" };
    case "event_top_x_lottery":
      return { kind: "event_top_x", eventKey: "capitol_war", topN: 10 };
    case "custom":
    case "officer_pick":
    default:
      return null;
  }
}

export type LegacyVipInput = {
  mechanism: string | null | undefined;
  config?: unknown;
};

function eventConfig(config: unknown): { eventKey: string; topN: number } {
  if (config && typeof config === "object") {
    const row = config as { eventKey?: unknown; topN?: unknown };
    const eventKey =
      typeof row.eventKey === "string" && row.eventKey.length > 0
        ? row.eventKey
        : "capitol_war";
    const topN =
      typeof row.topN === "number" && Number.isInteger(row.topN) && row.topN > 0
        ? row.topN
        : 10;
    return { eventKey, topN };
  }
  return { eventKey: "capitol_war", topN: 10 };
}

export function decodeVipRule(input: LegacyVipInput): VipRule | null {
  switch (input.mechanism) {
    case "none":
      return { kind: "none" };
    case "donations_second":
      return { kind: "donations_second" };
    case "event_top_x_lottery":
      return { kind: "event_top_x", ...eventConfig(input.config) };
    case "conductor_pick":
    default:
      return null;
  }
}

/** Mechanism string written to `train_conductor_records` history columns. */
export function encodeLegacyConductorMechanism(
  rule: ConductorRule | null,
): string {
  if (!rule) return "custom";
  switch (rule.kind) {
    case "vs_top_n":
      return "vs_top_n";
    case "vr_top_n":
      return "vr_top_n";
    case "rank_pool":
      if (rule.pool === "r3") return "r3_lottery";
      if (rule.pool === "r4_plus") return "r4_sequence";
      return "heavy_hitter_lottery";
    case "price_is_freight":
      // Matches what these days recorded before rules existed.
      return rule.board === "heavy_hitter"
        ? "heavy_hitter_lottery"
        : "r3_lottery";
    case "donations_top":
      return "donations_top";
    case "event_top_x":
      return "event_top_x_lottery";
  }
}

export function encodeLegacyVipMechanism(rule: VipRule | null): string {
  if (!rule) return "conductor_pick";
  if (rule.kind === "event_top_x") return "event_top_x_lottery";
  return rule.kind;
}
