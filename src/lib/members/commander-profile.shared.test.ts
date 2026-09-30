import { describe, expect, it } from "vitest";
import { parseEventScoreMetadata } from "@/lib/members/commander-profile.shared";

const FRONTLINE = "frontline-breakthrough";

describe("parseEventScoreMetadata", () => {
  it("returns nulls for non-object metadata", () => {
    expect(parseEventScoreMetadata(null, FRONTLINE)).toEqual({
      score: null,
      rank: null,
      frontlineStage: null,
    });
    expect(parseEventScoreMetadata("x", FRONTLINE).frontlineStage).toBeNull();
  });

  it("keeps a valid Frontline stage (including stages above 5)", () => {
    expect(
      parseEventScoreMetadata(
        { score: 2670, frontlineStage: 5, rank: 1 },
        FRONTLINE,
      ).frontlineStage,
    ).toBe(5);
    expect(
      parseEventScoreMetadata(
        { score: 2670, frontlineStage: 12, rank: 1 },
        FRONTLINE,
      ).frontlineStage,
    ).toBe(12);
  });

  it("allows missing stage for legacy rows", () => {
    expect(
      parseEventScoreMetadata({ score: 2670 }, FRONTLINE).frontlineStage,
    ).toBeNull();
  });

  it("rejects zero, negative, fractional and non-integer Frontline stages", () => {
    for (const stage of [0, -1, 1.5, "abc", NaN, Infinity]) {
      expect(
        parseEventScoreMetadata(
          { score: 100, frontlineStage: stage },
          FRONTLINE,
        ).frontlineStage,
      ).toBeNull();
    }
  });

  it("normalizes Frontline score strings and rejects invalid numerics", () => {
    expect(
      parseEventScoreMetadata({ score: "2670" }, FRONTLINE).score,
    ).toBe(2670);
    expect(
      parseEventScoreMetadata({ score: "x2,670" }, FRONTLINE).score,
    ).toBe(2670);
    for (const bad of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        parseEventScoreMetadata({ score: bad }, FRONTLINE).score,
      ).toBeNull();
    }
  });

  it("leaves non-Frontline targets unchanged", () => {
    const parsed = parseEventScoreMetadata(
      { score: 1234, frontlineStage: 3, rank: 2 },
      "desert-storm",
    );
    expect(parsed.score).toBe(1234);
    expect(parsed.rank).toBe(2);
    expect(parsed.frontlineStage).toBeNull();
    expect(
      parseEventScoreMetadata({ score: "not numeric" }, "desert-storm").score,
    ).toBeNull();
  });
});
