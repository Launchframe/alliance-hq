import { describe, expect, it } from "vitest";

import {
  canSpinConductorForDay,
  effectiveConductorMechanism,
} from "@/lib/trains/conductor-mechanism.shared";

describe("effectiveConductorMechanism", () => {
  it("maps r4_event_vip paint to r4_sequence for pool rolls", () => {
    expect(
      effectiveConductorMechanism("officer_pick", "r4_event_vip"),
    ).toBe("r4_sequence");
    expect(
      effectiveConductorMechanism("r4_sequence", "r4_event_vip"),
    ).toBe("r4_sequence");
  });

  it("maps Saturday price_is_right paint to heavy_hitter_lottery", () => {
    expect(
      effectiveConductorMechanism(
        "r3_lottery",
        "price_is_right",
        "2026-06-13",
      ),
    ).toBe("heavy_hitter_lottery");
    expect(
      effectiveConductorMechanism(
        "r3_lottery",
        "price_is_right",
        "2026-06-12",
      ),
    ).toBe("r3_lottery");
  });

  it("passes through other mechanisms unchanged", () => {
    expect(effectiveConductorMechanism("vs_top_10", "vs_push_weekdays")).toBe(
      "vs_top_10",
    );
  });

  it("maps top_vs / top_vr paint to parameterized mechanisms", () => {
    expect(effectiveConductorMechanism("custom", "top_vs")).toBe("vs_top_n");
    expect(effectiveConductorMechanism("custom", "top_vr")).toBe("vr_top_n");
  });
});

describe("canSpinConductorForDay", () => {
  it("allows spin wheel on r4_event_vip segment days", () => {
    expect(canSpinConductorForDay("officer_pick", false, "r4_event_vip")).toBe(
      true,
    );
    expect(canSpinConductorForDay("r4_sequence", false, "r4_event_vip")).toBe(
      true,
    );
  });

  it("allows spin on Saturday price_is_right even when stored as r3_lottery", () => {
    expect(
      canSpinConductorForDay(
        "r3_lottery",
        false,
        "price_is_right",
        "2026-06-13",
      ),
    ).toBe(true);
  });

  it("blocks officer_pick without r4_event_vip paint", () => {
    expect(canSpinConductorForDay("officer_pick", false, null)).toBe(false);
  });

  it("blocks the wheel for r3_recognition (manual award pick)", () => {
    expect(
      canSpinConductorForDay("r3_lottery", false, "r3_recognition"),
    ).toBe(false);
  });

  it("blocks the wheel for Top VS / legacy #1 (automatic)", () => {
    expect(canSpinConductorForDay("vs_high_score", false, null)).toBe(false);
    expect(
      canSpinConductorForDay("vs_top_n", false, "top_vs", null, { topN: 1 }),
    ).toBe(false);
  });

  it("allows the wheel for Top VS / Top VR scopes greater than 1", () => {
    expect(canSpinConductorForDay("vs_top_10", false, null)).toBe(true);
    expect(
      canSpinConductorForDay("vs_top_n", false, "top_vs", null, { topN: 5 }),
    ).toBe(true);
    expect(
      canSpinConductorForDay("vr_top_n", false, "top_vr", null, { topN: 3 }),
    ).toBe(true);
  });
});
