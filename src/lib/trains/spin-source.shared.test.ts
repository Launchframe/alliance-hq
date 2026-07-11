import { describe, expect, it } from "vitest";

import {
  conductorSpinSource,
  isPoolSpinSource,
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

  it("maps r3 lottery to the R3 pool", () => {
    expect(conductorSpinSource("r3_lottery", null)).toEqual({
      kind: "pool",
      poolType: "r3",
    });
    expect(
      conductorSpinSource("r3_lottery", "price_is_right", "2026-06-13"),
    ).toEqual({
      kind: "pool",
      poolType: "heavy_hitter",
    });
    expect(conductorSpinSource("heavy_hitter_lottery", null)).toEqual({
      kind: "pool",
      poolType: "heavy_hitter",
    });
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
