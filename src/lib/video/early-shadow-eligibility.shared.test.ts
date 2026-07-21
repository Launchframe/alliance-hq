import { describe, expect, it } from "vitest";

import {
  expectedVsRowCount,
  isPrimaryParseInadequate,
  isShadowPassTerminalStatus,
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

  it("ignores zero, negative, and NaN survey estimates (roster fallback)", () => {
    expect(
      expectedVsRowCount({ rosterSize: 100, surveyRowCountEstimate: 0 }),
    ).toBe(90);
    expect(
      expectedVsRowCount({ rosterSize: 100, surveyRowCountEstimate: -5 }),
    ).toBe(90);
    expect(
      expectedVsRowCount({
        rosterSize: 100,
        surveyRowCountEstimate: Number.NaN,
      }),
    ).toBe(90);
  });

  it("accepts roster exactly at the minimum", () => {
    expect(
      expectedVsRowCount({
        rosterSize: VS_EARLY_SHADOW_MIN_ROSTER,
        surveyRowCountEstimate: null,
      }),
    ).toBe(Math.floor(VS_EARLY_SHADOW_MIN_ROSTER * 0.9));
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

  it("does not trigger when frames×6 exactly covers expected rows", () => {
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 14,
        denseFrameCount: null,
        expectedRows: 84,
      }),
    ).toBe(false);
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 14,
        denseFrameCount: null,
        expectedRows: 85,
      }),
    ).toBe(true);
  });

  it("skips small expected counts (roster exactly 20 → expected 18 < min)", () => {
    const expectedRows = expectedVsRowCount({
      rosterSize: VS_EARLY_SHADOW_MIN_ROSTER,
      surveyRowCountEstimate: null,
    });
    expect(expectedRows).toBe(18);
    expect(
      shouldEnqueueEarlyExtractionShadow({
        scoreTargetId: "vs-performance",
        passRole: "primary",
        frameCount: 1,
        denseFrameCount: null,
        expectedRows,
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

  it("treats exactly-expected row count as adequate", () => {
    expect(
      isPrimaryParseInadequate({ uniqueRowCount: 83, expectedRows: 83 }),
    ).toBe(false);
  });

  it("is adequate when expected rows are unknown", () => {
    expect(
      isPrimaryParseInadequate({ uniqueRowCount: 0, expectedRows: null }),
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

describe("isShadowPassTerminalStatus", () => {
  it("marks review/complete/submitting/failed/discarded terminal and running states not", () => {
    for (const status of [
      "review",
      "complete",
      "submitting",
      "failed",
      "discarded",
    ]) {
      expect(isShadowPassTerminalStatus(status)).toBe(true);
    }
    for (const status of ["queued", "extracting", "parsing", "pending_approval"]) {
      expect(isShadowPassTerminalStatus(status)).toBe(false);
    }
  });
});
