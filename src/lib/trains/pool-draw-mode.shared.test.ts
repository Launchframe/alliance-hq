import { describe, expect, it } from "vitest";

import { poolUsesSequenceDraw } from "@/lib/trains/pool-draw-mode.shared";

describe("poolUsesSequenceDraw", () => {
  it("is true only for the R4+ sequence pool", () => {
    expect(poolUsesSequenceDraw("r4_plus")).toBe(true);
    expect(poolUsesSequenceDraw("r3")).toBe(false);
    expect(poolUsesSequenceDraw("all_members")).toBe(false);
    expect(poolUsesSequenceDraw("event_top_x")).toBe(false);
  });
});
