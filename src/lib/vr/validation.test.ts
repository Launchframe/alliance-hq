import { describe, expect, it } from "vitest";

import {
  formatBaseVrValidationError,
  initialBaseVrForBump,
  maxAllowedDowngradeForSeason,
  nextBaseVrForSeason,
  validateBaseVrForSeason,
} from "@/lib/vr/validation";

describe("season institute VR validation", () => {
  it("accepts ladder values for the season", () => {
    expect(validateBaseVrForSeason("1", 100).ok).toBe(true);
    expect(validateBaseVrForSeason("1", 3400).ok).toBe(true);
    expect(validateBaseVrForSeason("5", 28000).ok).toBe(true);
  });

  it("rejects off-ladder values with nearest neighbors", () => {
    const result = validateBaseVrForSeason("1", 3300);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("not_on_ladder");
    if (result.kind === "not_on_ladder") {
      expect(result.lower).toBe(3000);
      expect(result.upper).toBe(3400);
      expect(formatBaseVrValidationError(result)).toContain("3000");
      expect(formatBaseVrValidationError(result)).toContain("3400");
    }
  });

  it("rejects out-of-range values with min/max copy", () => {
    const result = validateBaseVrForSeason("1", -5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("out_of_range");
    expect(formatBaseVrValidationError(result)).toBe(
      "Enter a value between 100 and 10000.",
    );
  });

  it("bumps by institute level, including +400 steps", () => {
    expect(initialBaseVrForBump("1")).toBe(100);
    expect(nextBaseVrForSeason("1", 3000)).toBe(3400);
    expect(nextBaseVrForSeason("1", 10000)).toBeNull();
    expect(maxAllowedDowngradeForSeason("1", 3400)).toBe(3000);
  });
});
