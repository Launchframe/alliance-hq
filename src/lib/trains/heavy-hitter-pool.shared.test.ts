import { describe, expect, it } from "vitest";

import {
  isPriceIsRightHeavyHitterSaturday,
  isPriceIsRightPaintTemplate,
  paintTemplateUsesPriorDayVs,
  usesPriceIsFreightConductorRoll,
} from "@/lib/trains/heavy-hitter-pool.shared";

describe("isPriceIsRightHeavyHitterSaturday", () => {
  it("is true only for Saturday under legacy price_is_right paint", () => {
    expect(
      isPriceIsRightHeavyHitterSaturday("price_is_right", "2026-06-13"),
    ).toBe(true);
    expect(
      isPriceIsRightHeavyHitterSaturday("price_is_right", "2026-06-12"),
    ).toBe(false);
    expect(
      isPriceIsRightHeavyHitterSaturday("economy_week", "2026-06-13"),
    ).toBe(false);
    expect(isPriceIsRightHeavyHitterSaturday("price_is_right", null)).toBe(
      false,
    );
  });

  it("treats composite Saturday takedown_week as heavy-hitter day", () => {
    expect(
      isPriceIsRightHeavyHitterSaturday("takedown_week", "2026-06-13"),
    ).toBe(true);
    // Segment paint is always Saturday semantics even if date is omitted.
    expect(isPriceIsRightHeavyHitterSaturday("takedown_week", null)).toBe(
      true,
    );
  });
});

describe("usesPriceIsFreightConductorRoll", () => {
  it("includes weekday, legacy whole-week, and takedown Saturday paints", () => {
    expect(usesPriceIsFreightConductorRoll("price_is_right")).toBe(true);
    expect(usesPriceIsFreightConductorRoll("price_is_right_weekdays")).toBe(
      true,
    );
    expect(usesPriceIsFreightConductorRoll("takedown_week")).toBe(true);
    expect(usesPriceIsFreightConductorRoll("economy_week")).toBe(false);
    expect(usesPriceIsFreightConductorRoll(null)).toBe(false);
  });

  it("does not widen weekday raffle helper to takedown_week", () => {
    expect(isPriceIsRightPaintTemplate("takedown_week")).toBe(false);
  });

  it("does not treat Economy Week as a required prior-day VS paint", () => {
    expect(paintTemplateUsesPriorDayVs("economy_week")).toBe(false);
    expect(paintTemplateUsesPriorDayVs("price_is_right")).toBe(true);
    expect(paintTemplateUsesPriorDayVs("price_is_right_weekdays")).toBe(true);
  });
});
