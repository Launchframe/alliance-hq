import { describe, expect, it } from "vitest";

import {
  accumulatedFromPayload,
  hasSurveyAnswers,
  isSurveyComplete,
  mergeSurveyPayload,
  parseSurveyBody,
  schoolingAnswerToAboveAverage,
  surveyResumeStep,
} from "./survey";

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
      schoolingTuitionAnswer: null,
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
      schoolingTuitionAnswer: null,
    });
  });

  it("rounds fractional row counts", () => {
    expect(parseSurveyBody({ rowCountEstimate: 49.7 }).rowCountEstimate).toBe(50);
  });

  it("parses idk and maps aboveAverageScroll to null", () => {
    expect(
      parseSurveyBody({
        schoolingTuitionAnswer: "idk",
      }),
    ).toEqual({
      rowCountEstimate: null,
      scrollStyle: null,
      aboveAverageScroll: null,
      schoolingTuitionAnswer: "idk",
    });
  });

  it("maps yes/no schooling answers to aboveAverageScroll", () => {
    expect(parseSurveyBody({ schoolingTuitionAnswer: "yes" }).aboveAverageScroll).toBe(
      true,
    );
    expect(parseSurveyBody({ schoolingTuitionAnswer: "no" }).aboveAverageScroll).toBe(
      false,
    );
  });
});

describe("hasSurveyAnswers", () => {
  it("returns false when all fields are null", () => {
    expect(
      hasSurveyAnswers({
        rowCountEstimate: null,
        scrollStyle: null,
        aboveAverageScroll: null,
        schoolingTuitionAnswer: null,
      }),
    ).toBe(false);
  });

  it("returns true when any field is set", () => {
    expect(
      hasSurveyAnswers({
        rowCountEstimate: null,
        scrollStyle: "fast",
        aboveAverageScroll: null,
        schoolingTuitionAnswer: null,
      }),
    ).toBe(true);

    expect(
      hasSurveyAnswers({
        rowCountEstimate: null,
        scrollStyle: null,
        aboveAverageScroll: null,
        schoolingTuitionAnswer: "idk",
      }),
    ).toBe(true);
  });
});

describe("schoolingAnswerToAboveAverage", () => {
  it("maps answers", () => {
    expect(schoolingAnswerToAboveAverage("yes")).toBe(true);
    expect(schoolingAnswerToAboveAverage("no")).toBe(false);
    expect(schoolingAnswerToAboveAverage("idk")).toBeNull();
  });
});

describe("survey resume helpers", () => {
  it("detects complete surveys", () => {
    expect(
      isSurveyComplete({
        rowCountEstimate: 10,
        scrollStyle: "fast",
        aboveAverageScroll: null,
        schoolingTuitionAnswer: "idk",
      }),
    ).toBe(true);
  });

  it("returns resume step from partial answers", () => {
    expect(surveyResumeStep(null)).toBe(1);
    expect(
      surveyResumeStep({
        rowCountEstimate: 10,
        scrollStyle: null,
        aboveAverageScroll: null,
        schoolingTuitionAnswer: null,
      }),
    ).toBe(2);
    expect(
      surveyResumeStep({
        rowCountEstimate: 10,
        scrollStyle: "fast",
        aboveAverageScroll: null,
        schoolingTuitionAnswer: null,
      }),
    ).toBe(3);
  });

  it("maps legacy aboveAverageScroll into accumulated schooling answer", () => {
    expect(
      accumulatedFromPayload({
        rowCountEstimate: null,
        scrollStyle: null,
        aboveAverageScroll: true,
        schoolingTuitionAnswer: null,
      }).schoolingTuitionAnswer,
    ).toBe("yes");
  });
});

describe("mergeSurveyPayload", () => {
  it("preserves existing answers when the client sends a partial save", () => {
    expect(
      mergeSurveyPayload(
        {
          rowCountEstimate: 10,
          scrollStyle: "fast",
          aboveAverageScroll: null,
          schoolingTuitionAnswer: null,
        },
        {
          rowCountEstimate: null,
          scrollStyle: null,
          aboveAverageScroll: null,
          schoolingTuitionAnswer: "yes",
        },
      ),
    ).toEqual({
      rowCountEstimate: 10,
      scrollStyle: "fast",
      aboveAverageScroll: true,
      schoolingTuitionAnswer: "yes",
    });
  });

  it("overrides existing fields when the client sends new values", () => {
    expect(
      mergeSurveyPayload(
        {
          rowCountEstimate: 10,
          scrollStyle: "fast",
          aboveAverageScroll: null,
          schoolingTuitionAnswer: null,
        },
        {
          rowCountEstimate: 25,
          scrollStyle: "chaotic",
          aboveAverageScroll: null,
          schoolingTuitionAnswer: null,
        },
      ),
    ).toEqual({
      rowCountEstimate: 25,
      scrollStyle: "chaotic",
      aboveAverageScroll: null,
      schoolingTuitionAnswer: null,
    });
  });
});
