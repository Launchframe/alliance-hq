import { describe, expect, it } from "vitest";

import {
  conductorRuleChanged,
  conductorRuleIdentity,
  conductorRuleLabelKey,
  parseConductorRule,
  parseVipRule,
  vipRuleIdentity,
  type ConductorRule,
} from "@/lib/trains/rules/catalog.shared";

describe("conductorRuleIdentity", () => {
  it("treats free choice as its own identity, not an empty one", () => {
    expect(conductorRuleIdentity(null)).toBe("free_choice");
  });

  it("separates scopes of the same board", () => {
    expect(conductorRuleIdentity({ kind: "vs_top_n", topN: 5 })).not.toBe(
      conductorRuleIdentity({ kind: "vs_top_n", topN: 10 }),
    );
  });

  it("separates the R3 wheel from the R3 award", () => {
    expect(
      conductorRuleIdentity({ kind: "rank_pool", pool: "r3", draw: "wheel" }),
    ).not.toBe(
      conductorRuleIdentity({ kind: "rank_pool", pool: "r3", draw: "manual" }),
    );
  });

  it("reports no change between identical Top VS 10 rules", () => {
    // Regression: the old identity keyed on mechanism|paint|topN, so
    // vs_top_10 and vs_top_n+topN:10 looked like a rule change even though
    // both spin the same board.
    expect(
      conductorRuleChanged(
        { kind: "vs_top_n", topN: 10 },
        { kind: "vs_top_n", topN: 10 },
      ),
    ).toBe(false);
  });

  it("reports a change when the scope moves", () => {
    expect(
      conductorRuleChanged(
        { kind: "vs_top_n", topN: 5 },
        { kind: "vs_top_n", topN: 10 },
      ),
    ).toBe(true);
  });

  it("distinguishes event boards by key and scope", () => {
    expect(
      vipRuleIdentity({ kind: "event_top_x", eventKey: "meteorite", topN: 10 }),
    ).not.toBe(
      vipRuleIdentity({
        kind: "event_top_x",
        eventKey: "capitol_war",
        topN: 10,
      }),
    );
  });
});

describe("parseConductorRule", () => {
  it("accepts a valid rule", () => {
    expect(parseConductorRule({ kind: "vs_top_n", topN: 3 })).toEqual({
      kind: "vs_top_n",
      topN: 3,
    });
  });

  it("rejects an out-of-range scope rather than coercing it", () => {
    expect(parseConductorRule({ kind: "vs_top_n", topN: 7 })).toBeNull();
    expect(parseConductorRule({ kind: "vr_top_n", topN: 1 })).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(parseConductorRule({ kind: "vs_push_weekdays" })).toBeNull();
  });

  it("rejects a rule missing required params", () => {
    expect(parseConductorRule({ kind: "rank_pool", pool: "r3" })).toBeNull();
    expect(parseConductorRule({ kind: "vs_top_n" })).toBeNull();
  });

  it("treats null as free choice", () => {
    expect(parseConductorRule(null)).toBeNull();
  });
});

describe("parseVipRule", () => {
  it("keeps the skipped state", () => {
    expect(parseVipRule({ kind: "none" })).toEqual({ kind: "none" });
  });

  it("rejects conductor_pick, which is free choice (null), not a rule", () => {
    expect(parseVipRule({ kind: "conductor_pick" })).toBeNull();
  });
});

describe("conductorRuleLabelKey", () => {
  const cases: Array<[ConductorRule | null, string]> = [
    [null, "freeChoice"],
    [{ kind: "vs_top_n", topN: 1 }, "vsTop1"],
    [{ kind: "vs_top_n", topN: 10 }, "vsTopN"],
    [{ kind: "vr_top_n", topN: 3 }, "vrTopN"],
    [{ kind: "rank_pool", pool: "r3", draw: "wheel" }, "r3Lottery"],
    [{ kind: "rank_pool", pool: "r3", draw: "manual" }, "r3Award"],
    [{ kind: "rank_pool", pool: "r4_plus", draw: "wheel" }, "r4Rotation"],
    [
      { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" },
      "heavyHitterPool",
    ],
    [{ kind: "price_is_freight", board: "weekday" }, "priceIsFreightWeekday"],
    [
      { kind: "price_is_freight", board: "heavy_hitter" },
      "priceIsFreightHeavyHitter",
    ],
    [{ kind: "donations_top" }, "donationsTop"],
    [{ kind: "event_top_x", eventKey: "capitol_war", topN: 10 }, "eventTopX"],
  ];

  for (const [rule, key] of cases) {
    it(`labels ${rule?.kind ?? "free choice"} as ${key}`, () => {
      expect(conductorRuleLabelKey(rule)).toBe(key);
    });
  }
});
