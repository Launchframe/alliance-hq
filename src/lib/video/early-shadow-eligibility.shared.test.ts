import { describe, expect, it } from "vitest";

import {
  expectedVsRowCount,
  isPrimaryParseInadequate,
  shouldEnqueueEarlyExtractionShadow,
  VS_EARLY_SHADOW_MIN_ROSTER,
} from "./early-shadow-eligibility.shared";

describe("expectedVsRowCount", () => {
  it("prefers survey estimate when set", () => {
    expect(
      expectedVsRowCount({ rosterSize: 100, surveyRowCountEstimate: 42 }),
    ).toBe(42);
  });

  it("uses 90% of roster when survey is null and roster is large enough", () => {
    expect(
      expectedVsRowCount({ rosterSize: 93, surveyRowCountEstimate: null }),
    ).toBe(Math.floor(93 * 0.9));
  });

  it("returns null for small or missing roster without survey", () => {
    expect(
      expectedVsRowCount({
        rosterSize: VS_EARLY_SHADOW_MIN_ROSTER - 1,
        surveyRowCountEstimate: null,
      }),
    ).toBeNull();
    expect(
      expectedVsRowCount({ rosterSize: null, surveyRowCountEstimate: null }),
    ).toBeNull();
  });
});

describe("shouldEnqueueEarlyExtractionShadow", () => {
  it("requires vs-performance primary", () => {
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "desert-storm",
        passRole: "primary",
        frameCount: 4,
        denseFrameCount: 40,
        expectedRows: 83,
      }),
    ).toBe(false);
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "shadow",
        frameCount: 4,
        denseFrameCount: 40,
        expectedRows: 83,
      }),
    ).toBe(false);
  });

  it("triggers when frame×6 cannot cover expected rows (Roar-style)", () => {
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 4,
        denseFrameCount: null,
        expectedRows: 83,
      }),
    ).toBe(true);
  });

  it("triggers on dense-frame undersample", () => {
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 10,
        denseFrameCount: 40,
        expectedRows: 50,
      }),
    ).toBe(true);
  });

  it("skips when frames look sufficient", () => {
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 20,
        denseFrameCount: 30,
        expectedRows: 83,
      }),
    ).toBe(false);
  });
});

describe("isPrimaryParseInadequate", () => {
  it("compares unique rows to expected", () => {
    expect(
      isPrimaryParseInadequate({ uniqueRowCount: 20, expectedRows: 83 }),
    ).toBe(true);
    expect(
      isPrimaryParseInadequate({ uniqueRowCount: 90, expectedRows: 83 }),
    ).toBe(false);
  });

  it("honors forceInadequate for dev UX", () => {
    expect(
      isPrimaryParseInadequate({
        uniqueRowCount: 100,
        expectedRows: 50,
        forceInadequate: true,
      }),
    ).toBe(true);
  });
});
