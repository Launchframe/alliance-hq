import { describe, expect, it } from "vitest";

import { isPriceIsRightHeavyHitterSaturday } from "@/lib/trains/heavy-hitter-pool.shared";

describe("isPriceIsRightHeavyHitterSaturday", () => {
  it("is true only for Saturday under price_is_right paint", () => {
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
});
