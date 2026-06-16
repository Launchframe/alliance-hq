import { describe, expect, it } from "vitest";
import { computeQualityScore } from "@/lib/video/quality-score";

describe("computeQualityScore", () => {
  it("returns perfect when nothing was edited or deleted", () => {
    const result = computeQualityScore({
      rowsSaved: 50,
      rowsEdited: 0,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityBucket).toBe("perfect");
    expect(result.qualityScore).toBe(1);
  });

  it("returns q1 for small number of edits", () => {
    const result = computeQualityScore({
      rowsSaved: 50,
      rowsEdited: 5,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityScore).toBe(0.9);
    expect(result.qualityBucket).toBe("q1");
  });

  it("returns dropped_the_ball for discarded job with enough rows", () => {
    const result = computeQualityScore({
      rowsSaved: 10,
      rowsEdited: 0,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "discarded",
    });
    expect(result.qualityBucket).toBe("dropped_the_ball");
  });

  it("does not penalize discarded job with fewer than 3 rows", () => {
    const result = computeQualityScore({
      rowsSaved: 2,
      rowsEdited: 0,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "discarded",
    });
    expect(result.qualityBucket).not.toBe("dropped_the_ball");
  });

  it("returns dropped_the_ball for negative score", () => {
    const result = computeQualityScore({
      rowsSaved: 10,
      rowsEdited: 8,
      rowsDeleted: 5,
      rowsAdded: 2,
      status: "complete",
    });
    expect(result.qualityBucket).toBe("dropped_the_ball");
  });

  it("clamps quality score to [-1, 1]", () => {
    const result = computeQualityScore({
      rowsSaved: 5,
      rowsEdited: 20,
      rowsDeleted: 10,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityScore).toBe(-1);
  });

  it("returns q2 for 60-79% accuracy", () => {
    const result = computeQualityScore({
      rowsSaved: 10,
      rowsEdited: 3,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityScore).toBe(0.7);
    expect(result.qualityBucket).toBe("q2");
  });

  it("returns q5 for very low accuracy", () => {
    const result = computeQualityScore({
      rowsSaved: 10,
      rowsEdited: 9,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityScore).toBe(0.1);
    expect(result.qualityBucket).toBe("q5");
  });

  it("returns dropped_the_ball for zero rows saved", () => {
    const result = computeQualityScore({
      rowsSaved: 0,
      rowsEdited: 0,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityBucket).toBe("dropped_the_ball");
    expect(result.qualityScore).toBe(0);
  });

  it("perfect requires no deletions even with high score", () => {
    const result = computeQualityScore({
      rowsSaved: 20,
      rowsEdited: 0,
      rowsDeleted: 1,
      rowsAdded: 0,
      status: "complete",
    });
    // score = (20 - 0 - 1 - 0) / 20 = 0.95 — but deleted > 0 so not perfect
    expect(result.qualityBucket).toBe("q1");
  });

  it("perfect requires no edits even with high score", () => {
    const result = computeQualityScore({
      rowsSaved: 20,
      rowsEdited: 1,
      rowsDeleted: 0,
      rowsAdded: 0,
      status: "complete",
    });
    expect(result.qualityScore).toBe(0.95);
    expect(result.qualityBucket).toBe("q1");
  });
});
