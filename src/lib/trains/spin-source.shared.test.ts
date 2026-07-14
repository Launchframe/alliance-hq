import { describe, expect, it } from "vitest";

import {
  conductorSpinSource,
  isPoolSpinSource,
  isPriceIsRightSpinSource,
  vipSpinSource,
} from "@/lib/trains/spin-source.shared";

describe("conductorSpinSource", () => {
  it("maps r4_event_vip paint to the R4 pool", () => {
    const source = conductorSpinSource("officer_pick", "r4_event_vip");
    expect(isPoolSpinSource(source)).toBe(true);
    if (source?.kind === "pool") {
      expect(source.poolType).toBe("r4_plus");
    }
  });

  it("maps non-TPIF r3 lottery to the R3 pool", () => {
    expect(conductorSpinSource("r3_lottery", null)).toEqual({
      kind: "pool",
      poolType: "r3",
    });
    expect(conductorSpinSource("heavy_hitter_lottery", null)).toEqual({
      kind: "pool",
      poolType: "heavy_hitter",
    });
  });

  it("maps Price Is Freight weekdays to a non-pool raffle source", () => {
    // 2026-06-09 is a Monday (UTC−2 calendar).
    const source = conductorSpinSource(
      "r3_lottery",
      "price_is_right",
      "2026-06-09",
    );
    expect(isPriceIsRightSpinSource(source)).toBe(true);
    expect(isPoolSpinSource(source)).toBe(false);
    expect(source).toEqual({ kind: "price_is_right_raffle" });
  });

  it("maps Price Is Freight Saturdays to a non-pool heavy-hitter source", () => {
    // 2026-06-13 is a Saturday.
    const source = conductorSpinSource(
      "r3_lottery",
      "price_is_right",
      "2026-06-13",
    );
    expect(source).toEqual({ kind: "price_is_right_heavy_hitter" });
    expect(isPoolSpinSource(source)).toBe(false);
  });

  it("maps VS top 10 to a leaderboard source", () => {
    expect(conductorSpinSource("vs_top_10", null)).toEqual({
      kind: "vs_leaderboard",
      topN: 10,
    });
  });
});

describe("vipSpinSource", () => {
  it("maps event VIP to the event top scorers pool", () => {
    expect(vipSpinSource("event_top_x_lottery")).toEqual({
      kind: "pool",
      poolType: "event_top_x",
    });
  });
});
