import { describe, expect, it } from "vitest";

import {
  decodeConductorRule,
  decodeVipRule,
  encodeLegacyConductorMechanism,
  encodeLegacyVipMechanism,
  type LegacyConductorInput,
} from "@/lib/trains/rules/encode.shared";
import type {
  ConductorRule,
  VipRule,
} from "@/lib/trains/rules/catalog.shared";

/**
 * Contract for `drizzle/0181_train_day_rules.sql`.
 *
 * Every row here must be produced identically by the SQL backfill. If you
 * change one, change both — the migration is irreversible and a silent
 * mismatch rewrites live schedules.
 */
const PARITY_TABLE: Array<{
  name: string;
  legacy: LegacyConductorInput;
  rule: ConductorRule | null;
}> = [
  {
    name: "legacy vs_high_score is Top VS 1",
    legacy: { mechanism: "vs_high_score" },
    rule: { kind: "vs_top_n", topN: 1 },
  },
  {
    name: "legacy vs_top_10 is Top VS 10",
    legacy: { mechanism: "vs_top_10" },
    rule: { kind: "vs_top_n", topN: 10 },
  },
  {
    name: "vs_top_n keeps its configured scope",
    legacy: { mechanism: "vs_top_n", topN: 5 },
    rule: { kind: "vs_top_n", topN: 5 },
  },
  {
    name: "vs_top_n without scope defaults to 10",
    legacy: { mechanism: "vs_top_n", topN: null },
    rule: { kind: "vs_top_n", topN: 10 },
  },
  {
    name: "vs_top_n with an invalid scope falls back to 10",
    legacy: { mechanism: "vs_top_n", topN: 7 },
    rule: { kind: "vs_top_n", topN: 10 },
  },
  {
    name: "top_vs paint keeps its scope",
    legacy: { mechanism: "vs_top_n", paintTemplate: "top_vs", topN: 3 },
    rule: { kind: "vs_top_n", topN: 3 },
  },
  {
    name: "vr_top_n defaults to 3",
    legacy: { mechanism: "vr_top_n" },
    rule: { kind: "vr_top_n", topN: 3 },
  },
  {
    name: "top_vr paint keeps its scope",
    legacy: { mechanism: "vr_top_n", paintTemplate: "top_vr", topN: 5 },
    rule: { kind: "vr_top_n", topN: 5 },
  },
  {
    name: "economy week is the R3 wheel",
    legacy: { mechanism: "r3_lottery", paintTemplate: "economy_week" },
    rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
  },
  {
    name: "r3 recognition is the manual R3 award",
    legacy: { mechanism: "r3_lottery", paintTemplate: "r3_recognition" },
    rule: { kind: "rank_pool", pool: "r3", draw: "manual" },
  },
  {
    name: "price_is_right_weekdays is the PIF weekday raffle",
    legacy: {
      mechanism: "r3_lottery",
      paintTemplate: "price_is_right_weekdays",
    },
    rule: { kind: "price_is_freight", board: "weekday" },
  },
  {
    name: "takedown_week is the PIF max-ticket draw",
    legacy: {
      mechanism: "heavy_hitter_lottery",
      paintTemplate: "takedown_week",
    },
    rule: { kind: "price_is_freight", board: "heavy_hitter" },
  },
  {
    name: "legacy whole-week price_is_right on Saturday is the max-ticket draw",
    legacy: {
      mechanism: "r3_lottery",
      paintTemplate: "price_is_right",
      date: "2026-08-15",
    },
    rule: { kind: "price_is_freight", board: "heavy_hitter" },
  },
  {
    name: "legacy whole-week price_is_right midweek is the weekday raffle",
    legacy: {
      mechanism: "r3_lottery",
      paintTemplate: "price_is_right",
      date: "2026-08-12",
    },
    rule: { kind: "price_is_freight", board: "weekday" },
  },
  {
    name: "heavy_hitter_lottery without PIF paint stays a depleting pool",
    legacy: { mechanism: "heavy_hitter_lottery" },
    rule: { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" },
  },
  {
    name: "r4_sequence is the R4+ rotation",
    legacy: { mechanism: "r4_sequence" },
    rule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
  },
  {
    name: "r4_event_vip paint is the R4+ rotation",
    legacy: { mechanism: "r4_sequence", paintTemplate: "r4_event_vip" },
    rule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
  },
  {
    name: "donations_top carries over",
    legacy: { mechanism: "donations_top" },
    rule: { kind: "donations_top" },
  },
  {
    name: "event_top_x_lottery carries over with defaults",
    legacy: { mechanism: "event_top_x_lottery" },
    rule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
  },
  {
    name: "custom becomes free choice",
    legacy: { mechanism: "custom" },
    rule: null,
  },
  {
    name: "officer_pick becomes free choice",
    legacy: { mechanism: "officer_pick" },
    rule: null,
  },
  {
    name: "an unknown mechanism becomes free choice",
    legacy: { mechanism: "something_removed" },
    rule: null,
  },
  {
    name: "a missing mechanism becomes free choice",
    legacy: { mechanism: null },
    rule: null,
  },
];

describe("decodeConductorRule (SQL backfill parity)", () => {
  for (const row of PARITY_TABLE) {
    it(row.name, () => {
      expect(decodeConductorRule(row.legacy)).toEqual(row.rule);
    });
  }

  it("prefers the paint template over the stored mechanism", () => {
    // The roll path keyed on paint, so paint is the source of truth: these
    // days ran the PIF raffle even though the column said r3_lottery.
    expect(
      decodeConductorRule({
        mechanism: "r3_lottery",
        paintTemplate: "price_is_right_weekdays",
      }),
    ).toEqual({ kind: "price_is_freight", board: "weekday" });
  });
});

describe("decodeVipRule", () => {
  it("maps conductor_pick to free choice", () => {
    expect(decodeVipRule({ mechanism: "conductor_pick" })).toBeNull();
  });

  it("keeps the explicit skipped state distinct from free choice", () => {
    expect(decodeVipRule({ mechanism: "none" })).toEqual({ kind: "none" });
  });

  it("maps donations_second", () => {
    expect(decodeVipRule({ mechanism: "donations_second" })).toEqual({
      kind: "donations_second",
    });
  });

  it("carries the event config", () => {
    expect(
      decodeVipRule({
        mechanism: "event_top_x_lottery",
        config: { eventKey: "meteorite", topN: 5 },
      }),
    ).toEqual({ kind: "event_top_x", eventKey: "meteorite", topN: 5 });
  });

  it("defaults a malformed event config", () => {
    expect(
      decodeVipRule({
        mechanism: "event_top_x_lottery",
        config: { topN: "ten" },
      }),
    ).toEqual({ kind: "event_top_x", eventKey: "capitol_war", topN: 10 });
  });
});

describe("encodeLegacyConductorMechanism (history columns)", () => {
  const cases: Array<[ConductorRule | null, string]> = [
    [{ kind: "vs_top_n", topN: 3 }, "vs_top_n"],
    [{ kind: "vr_top_n", topN: 5 }, "vr_top_n"],
    [{ kind: "rank_pool", pool: "r3", draw: "wheel" }, "r3_lottery"],
    [{ kind: "rank_pool", pool: "r3", draw: "manual" }, "r3_lottery"],
    [{ kind: "rank_pool", pool: "r4_plus", draw: "wheel" }, "r4_sequence"],
    [
      { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" },
      "heavy_hitter_lottery",
    ],
    [{ kind: "price_is_freight", board: "weekday" }, "r3_lottery"],
    [
      { kind: "price_is_freight", board: "heavy_hitter" },
      "heavy_hitter_lottery",
    ],
    [{ kind: "donations_top" }, "donations_top"],
    [
      { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
      "event_top_x_lottery",
    ],
    [null, "custom"],
  ];

  for (const [rule, mechanism] of cases) {
    it(`writes ${mechanism} for ${rule?.kind ?? "free choice"}`, () => {
      expect(encodeLegacyConductorMechanism(rule)).toBe(mechanism);
    });
  }
});

describe("encodeLegacyVipMechanism (history columns)", () => {
  const cases: Array<[VipRule | null, string]> = [
    [null, "conductor_pick"],
    [{ kind: "none" }, "none"],
    [{ kind: "donations_second" }, "donations_second"],
    [
      { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
      "event_top_x_lottery",
    ],
  ];

  for (const [rule, mechanism] of cases) {
    it(`writes ${mechanism}`, () => {
      expect(encodeLegacyVipMechanism(rule)).toBe(mechanism);
    });
  }
});

describe("round trip", () => {
  it("re-decodes an encoded rule to an equivalent draw", () => {
    const rules: ConductorRule[] = [
      { kind: "vs_top_n", topN: 5 },
      { kind: "vr_top_n", topN: 3 },
      { kind: "rank_pool", pool: "r3", draw: "wheel" },
      { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
      { kind: "donations_top" },
    ];
    for (const rule of rules) {
      const mechanism = encodeLegacyConductorMechanism(rule);
      const topN = "topN" in rule ? rule.topN : null;
      expect(decodeConductorRule({ mechanism, topN })).toEqual(rule);
    }
  });
});
