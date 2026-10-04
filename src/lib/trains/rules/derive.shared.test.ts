import { describe, expect, it } from "vitest";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  canSpinConductorForRule,
  canSpinVipForRule,
  conductorRuleAppliesMinimums,
  conductorRuleNeedsWheel,
  conductorRulePoolType,
  conductorRuleSourceDay,
  conductorRuleUsesPriceIsFreightRoll,
  isMemberEligibleForConductorRule,
  spinSourceForConductorRule,
  spinSourceForVipRule,
  validateConductorRuleOnDate,
  validateConductorRuleOnWeekday,
} from "@/lib/trains/rules/derive.shared";

const VS_TOP_10: ConductorRule = { kind: "vs_top_n", topN: 10 };
const VS_TOP_1: ConductorRule = { kind: "vs_top_n", topN: 1 };
const R3_WHEEL: ConductorRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };
const R3_AWARD: ConductorRule = {
  kind: "rank_pool",
  pool: "r3",
  draw: "manual",
};
const R4: ConductorRule = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };
const PIF_WEEKDAY: ConductorRule = {
  kind: "price_is_freight",
  board: "weekday",
};
const PIF_HH: ConductorRule = {
  kind: "price_is_freight",
  board: "heavy_hitter",
};

describe("conductorRuleSourceDay", () => {
  // 2026-08-12 is a Wednesday.
  it("reads T-1 with no lead time", () => {
    expect(conductorRuleSourceDay(VS_TOP_10, "2026-08-12", 0)).toEqual({
      kind: "score_day",
      date: "2026-08-11",
    });
  });

  it("shifts the source day by lead time", () => {
    expect(conductorRuleSourceDay(VS_TOP_10, "2026-08-12", 1)).toEqual({
      kind: "score_day",
      date: "2026-08-10",
    });
    expect(conductorRuleSourceDay(VS_TOP_10, "2026-08-12", 3)).toEqual({
      kind: "score_day",
      date: "2026-08-08",
    });
  });

  it("gives Price Is Freight the same score day", () => {
    expect(conductorRuleSourceDay(PIF_WEEKDAY, "2026-08-12", 0)).toEqual({
      kind: "score_day",
      date: "2026-08-11",
    });
  });

  it("has no source day for roster and season rules", () => {
    for (const rule of [
      R3_WHEEL,
      R4,
      { kind: "vr_top_n", topN: 3 } as ConductorRule,
      { kind: "event_top_x", eventKey: "capitol_war", topN: 10 } as ConductorRule,
    ]) {
      expect(conductorRuleSourceDay(rule, "2026-08-12", 0)).toEqual({
        kind: "none",
      });
    }
  });

  it("has no source day for free choice", () => {
    expect(conductorRuleSourceDay(null, "2026-08-12", 0)).toEqual({
      kind: "none",
    });
  });
});

describe("validateConductorRuleOnWeekday", () => {
  // Sunday (0) is the VS break. A VS rule is invalid when its *source* day
  // lands there, which lead time moves around the week.
  it("rejects a VS rule on Monday with no lead time", () => {
    expect(validateConductorRuleOnWeekday(VS_TOP_10, 1, 0)).toEqual({
      ok: false,
      reason: "source_day_not_vs_day",
      sourceDow: 0,
    });
  });

  it("accepts a VS rule Tue-Sun with no lead time", () => {
    for (const dow of [2, 3, 4, 5, 6, 0]) {
      expect(validateConductorRuleOnWeekday(VS_TOP_10, dow, 0)).toEqual({
        ok: true,
      });
    }
  });

  it("moves the invalid day to Tuesday at lead time 1", () => {
    expect(validateConductorRuleOnWeekday(VS_TOP_10, 2, 1)).toEqual({
      ok: false,
      reason: "source_day_not_vs_day",
      sourceDow: 0,
    });
    expect(validateConductorRuleOnWeekday(VS_TOP_10, 1, 1)).toEqual({
      ok: true,
    });
  });

  it("moves the invalid day to Saturday at lead time 5", () => {
    expect(validateConductorRuleOnWeekday(VS_TOP_10, 6, 5)).toEqual({
      ok: false,
      reason: "source_day_not_vs_day",
      sourceDow: 0,
    });
  });

  it("applies the same rule to Price Is Freight", () => {
    expect(validateConductorRuleOnWeekday(PIF_WEEKDAY, 1, 0).ok).toBe(false);
    expect(validateConductorRuleOnWeekday(PIF_HH, 1, 0).ok).toBe(false);
  });

  it("never blocks roster, season, or free-choice rules", () => {
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      expect(validateConductorRuleOnWeekday(R3_WHEEL, dow, 0).ok).toBe(true);
      expect(validateConductorRuleOnWeekday(R4, dow, 3).ok).toBe(true);
      expect(validateConductorRuleOnWeekday(null, dow, 0).ok).toBe(true);
    }
  });

  it("resolves the weekday from a date", () => {
    // 2026-08-10 is a Monday.
    expect(validateConductorRuleOnDate(VS_TOP_10, "2026-08-10", 0).ok).toBe(
      false,
    );
    expect(validateConductorRuleOnDate(VS_TOP_10, "2026-08-11", 0).ok).toBe(
      true,
    );
  });
});

describe("spinSourceForConductorRule", () => {
  it("maps each rule to its board", () => {
    expect(spinSourceForConductorRule(VS_TOP_10)).toEqual({
      kind: "vs_leaderboard",
      topN: 10,
    });
    expect(spinSourceForConductorRule({ kind: "vr_top_n", topN: 5 })).toEqual({
      kind: "vr_leaderboard",
      topN: 5,
    });
    expect(spinSourceForConductorRule(R3_WHEEL)).toEqual({
      kind: "pool",
      poolType: "r3",
    });
    expect(spinSourceForConductorRule(PIF_WEEKDAY)).toEqual({
      kind: "price_is_right_raffle",
    });
    expect(spinSourceForConductorRule(PIF_HH)).toEqual({
      kind: "price_is_right_heavy_hitter",
    });
    expect(spinSourceForConductorRule({ kind: "donations_top" })).toEqual({
      kind: "donations_leaderboard",
      rank: 1,
    });
    expect(spinSourceForConductorRule(null)).toBeNull();
  });
});

describe("spinSourceForVipRule", () => {
  it("has no board for free choice or a skipped VIP", () => {
    expect(spinSourceForVipRule(null)).toBeNull();
    expect(spinSourceForVipRule({ kind: "none" })).toBeNull();
  });

  it("maps donations and event lotteries", () => {
    expect(spinSourceForVipRule({ kind: "donations_second" })).toEqual({
      kind: "donations_leaderboard",
      rank: 2,
    });
    expect(
      spinSourceForVipRule({
        kind: "event_top_x",
        eventKey: "capitol_war",
        topN: 10,
      }),
    ).toEqual({ kind: "pool", poolType: "event_top_x" });
  });
});

describe("wheel and pool derivation", () => {
  it("spins every rule except automatic and manual ones", () => {
    expect(conductorRuleNeedsWheel(VS_TOP_10)).toBe(true);
    expect(conductorRuleNeedsWheel(VS_TOP_1)).toBe(false);
    expect(conductorRuleNeedsWheel({ kind: "donations_top" })).toBe(false);
    expect(conductorRuleNeedsWheel(R3_AWARD)).toBe(false);
    expect(conductorRuleNeedsWheel(R3_WHEEL)).toBe(true);
    expect(conductorRuleNeedsWheel(null)).toBe(false);
  });

  it("blocks spinning a locked day", () => {
    expect(canSpinConductorForRule(VS_TOP_10, false)).toBe(true);
    expect(canSpinConductorForRule(VS_TOP_10, true)).toBe(false);
  });

  it("requires a lock before the VIP spins", () => {
    expect(canSpinVipForRule({ kind: "donations_second" }, false)).toBe(false);
    expect(canSpinVipForRule({ kind: "donations_second" }, true)).toBe(true);
    expect(canSpinVipForRule({ kind: "none" }, true)).toBe(false);
    expect(canSpinVipForRule(null, true)).toBe(false);
  });

  it("maps depleting pools", () => {
    expect(conductorRulePoolType(R3_WHEEL)).toBe("r3");
    expect(conductorRulePoolType(R4)).toBe("r4_plus");
    expect(conductorRulePoolType(VS_TOP_10)).toBeNull();
    // Price Is Freight draws with replacement — never a depleting pool.
    expect(conductorRulePoolType(PIF_WEEKDAY)).toBeNull();
    expect(conductorRulePoolType(PIF_HH)).toBeNull();
  });

  it("routes only Price Is Freight to the with-replacement roll", () => {
    expect(conductorRuleUsesPriceIsFreightRoll(PIF_WEEKDAY)).toBe(true);
    expect(conductorRuleUsesPriceIsFreightRoll(PIF_HH)).toBe(true);
    expect(
      conductorRuleUsesPriceIsFreightRoll({
        kind: "rank_pool",
        pool: "heavy_hitter",
        draw: "wheel",
      }),
    ).toBe(false);
  });

  it("applies conductor minimums to Price Is Freight only", () => {
    expect(conductorRuleAppliesMinimums(PIF_WEEKDAY)).toBe(true);
    expect(conductorRuleAppliesMinimums(PIF_HH)).toBe(true);
    expect(conductorRuleAppliesMinimums(R3_WHEEL)).toBe(false);
    expect(conductorRuleAppliesMinimums(VS_TOP_10)).toBe(false);
  });
});

describe("isMemberEligibleForConductorRule", () => {
  const onRoster = { memberId: "m1", onRoster: true };

  it("requires a member on the roster", () => {
    expect(
      isMemberEligibleForConductorRule({
        memberId: null,
        onRoster: true,
        allianceRank: 3,
        rule: R3_WHEEL,
      }),
    ).toBe(false);
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        onRoster: false,
        allianceRank: 3,
        rule: R3_WHEEL,
      }),
    ).toBe(false);
  });

  it("enforces rank when rank is the rule", () => {
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 3,
        rule: R3_WHEEL,
      }),
    ).toBe(true);
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 2,
        rule: R3_WHEEL,
      }),
    ).toBe(false);
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 4,
        rule: R4,
      }),
    ).toBe(true);
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 3,
        rule: R4,
      }),
    ).toBe(false);
  });

  it("fails open for boards it cannot see", () => {
    // Regression: a heavy-hitter Saturday paint used to fall through to
    // false and pull a valid on-roster conductor off the day.
    for (const rule of [
      VS_TOP_10,
      { kind: "vr_top_n", topN: 3 } as ConductorRule,
      PIF_HH,
      { kind: "donations_top" } as ConductorRule,
      { kind: "event_top_x", eventKey: "capitol_war", topN: 10 } as ConductorRule,
      { kind: "rank_pool", pool: "heavy_hitter", draw: "wheel" } as ConductorRule,
      null,
    ]) {
      expect(
        isMemberEligibleForConductorRule({
          ...onRoster,
          allianceRank: 1,
          rule,
        }),
      ).toBe(true);
    }
  });

  it("keeps the R3 check for the Price Is Freight weekday raffle", () => {
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 3,
        rule: PIF_WEEKDAY,
      }),
    ).toBe(true);
    expect(
      isMemberEligibleForConductorRule({
        ...onRoster,
        allianceRank: 4,
        rule: PIF_WEEKDAY,
      }),
    ).toBe(false);
  });
});
