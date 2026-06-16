import { describe, expect, it } from "vitest";

import { hasSurveyAnswers, parseSurveyBody } from "./survey";

describe("parseSurveyBody", () => {
  it("accepts valid partial answers", () => {
    expect(
      parseSurveyBody({
        rowCountEstimate: 42,
        scrollStyle: "slow_steady",
        aboveAverageScroll: true,
      }),
    ).toEqual({
      rowCountEstimate: 42,
      scrollStyle: "slow_steady",
      aboveAverageScroll: true,
    });
  });

  it("rejects invalid row counts and scroll styles", () => {
    expect(
      parseSurveyBody({
        rowCountEstimate: 0,
        scrollStyle: "teleport",
        aboveAverageScroll: "yes",
      } as Record<string, unknown>),
    ).toEqual({
      rowCountEstimate: null,
      scrollStyle: null,
      aboveAverageScroll: null,
    });
  });

  it("rounds fractional row counts", () => {
    expect(parseSurveyBody({ rowCountEstimate: 49.7 }).rowCountEstimate).toBe(50);
  });
});

describe("hasSurveyAnswers", () => {
  it("returns false when all fields are null", () => {
    expect(
      hasSurveyAnswers({
        rowCountEstimate: null,
        scrollStyle: null,
        aboveAverageScroll: null,
      }),
    ).toBe(false);
  });

  it("returns true when any field is set", () => {
    expect(
      hasSurveyAnswers({
        rowCountEstimate: null,
        scrollStyle: "fast",
        aboveAverageScroll: null,
      }),
    ).toBe(true);
  });
});
