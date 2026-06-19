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

  it("passes through other mechanisms unchanged", () => {
    expect(effectiveConductorMechanism("vs_top_10", "vs_push_weekdays")).toBe(
      "vs_top_10",
    );
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

  it("blocks officer_pick without r4_event_vip paint", () => {
    expect(canSpinConductorForDay("officer_pick", false, null)).toBe(false);
  });
});
