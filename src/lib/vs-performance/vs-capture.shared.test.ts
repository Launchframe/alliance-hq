import { describe, expect, it } from "vitest";

import {
  buildVsCaptureCommit,
  mergeVsCaptureResults,
  type VsCaptureCommit,
} from "./vs-capture.shared";
import type { VsDayResult } from "./match-results.shared";
import { VsPerformanceError } from "./weekly-plan.shared";

const TODAY = "2026-09-28";
const WEEK = "2026-09-21";

function alliance(tag: string) {
  return { server: 1236, tag, name: "Alliance" };
}

function dailyReview(partial: Record<string, unknown> = {}) {
  return {
    kind: "daily_totals",
    weekStart: WEEK,
    day: 2,
    ourSide: "left",
    confirmSides: true,
    left: alliance("US"),
    right: alliance("THEM"),
    leftScore: "0",
    rightScore: "0",
    finalDay: false,
    ...partial,
  };
}

function weeklyReview(partial: Record<string, unknown> = {}) {
  return {
    kind: "weekly_overview",
    weekStart: WEEK,
    ourSide: "left",
    confirmSides: true,
    left: alliance("US"),
    right: alliance("THEM"),
    leftPoints: 7,
    rightPoints: 6,
    dayResults: [
      { day: 1, winner: "left" },
      { day: 2, winner: "left" },
      { day: 3, winner: "left" },
      { day: 4, winner: "left" },
      { day: 5, winner: "right" },
      { day: 6, winner: "right" },
    ],
    ...partial,
  };
}

describe("buildVsCaptureCommit daily", () => {
  it("writes nothing for an unfinished day", () => {
    const commit = buildVsCaptureCommit(dailyReview(), TODAY);
    expect(commit.days).toEqual([]);
    expect(commit.weeklyPoints).toBeNull();
    expect(commit.weekOutcome).toBeNull();
  });

  it("rejects a final day marked on a current-or-future date", () => {
    expect(() =>
      buildVsCaptureCommit(
        dailyReview({ finalDay: true, weekStart: "2026-09-28", day: 1 }),
        TODAY,
      ),
    ).toThrow(VsPerformanceError);
  });

  it("derives a won result when our side holds the higher score", () => {
    const commit = buildVsCaptureCommit(
      dailyReview({
        finalDay: true,
        leftScore: "12345678",
        rightScore: "11000000",
      }),
      TODAY,
    );
    expect(commit.days).toHaveLength(1);
    expect(commit.days[0]).toMatchObject({
      recordedDate: "2026-09-22",
      finality: "final",
      outcome: "won",
      totals: { ourScore: "12345678", opponentScore: "11000000" },
    });
  });

  it("flips the outcome when our alliance is on the right", () => {
    const commit = buildVsCaptureCommit(
      dailyReview({
        ourSide: "right",
        finalDay: true,
        leftScore: "12345678",
        rightScore: "11000000",
      }),
      TODAY,
    );
    expect(commit.days[0]).toMatchObject({
      outcome: "lost",
      totals: { ourScore: "11000000", opponentScore: "12345678" },
    });
  });

  it("rejects raw OCR/image extras and unbounded identity values before audit", () => {
    for (const extra of [{ rawOcr: "unbounded raw text" }, { image: "data:image/png;base64,AA==" }, { left: { ...alliance("US"), name: "x".repeat(121) } }]) {
      expect(() => buildVsCaptureCommit(dailyReview(extra), TODAY)).toThrow(expect.objectContaining({ code: "capture_invalid" }));
    }
  });
});

describe("buildVsCaptureCommit weekly", () => {
  it("produces six outcome-only final rows and a derived week outcome", () => {
    const commit = buildVsCaptureCommit(
      weeklyReview({ weekStart: "2026-09-14" }),
      "2026-09-28",
    );
    expect(commit.days).toHaveLength(6);
    expect(commit.days.every((d) => d.finality === "final")).toBe(true);
    expect(commit.days.every((d) => d.totals === null)).toBe(true);
    expect(commit.weeklyPoints).toEqual({ ours: 7, theirs: 6 });
    expect(commit.weekOutcome).toBe("win");
  });

  it("derives a loss for the flipped side", () => {
    const commit = buildVsCaptureCommit(
      weeklyReview({ weekStart: "2026-09-14", ourSide: "right" }),
      "2026-09-28",
    );
    expect(commit.weekOutcome).toBe("loss");
    expect(commit.weeklyPoints).toEqual({ ours: 6, theirs: 7 });
  });

  it("rejects header points that disagree with the day winners", () => {
    expect(() =>
      buildVsCaptureCommit(
        weeklyReview({
          weekStart: "2026-09-14",
          leftPoints: 6,
          rightPoints: 7,
        }),
        "2026-09-28",
      ),
    ).toThrow(expect.objectContaining({ code: "capture_point_mismatch" }));
  });

  it("keeps all-unknown days pending with no outcome", () => {
    const commit = buildVsCaptureCommit(
      weeklyReview({
        leftPoints: 0,
        rightPoints: 0,
        dayResults: Array.from({ length: 6 }, (_, i) => ({
          day: i + 1,
          winner: "unknown",
        })),
      }),
      TODAY,
    );
    expect(commit.days).toEqual([]);
    expect(commit.weekOutcome).toBeNull();
    expect(commit.weeklyPoints).toEqual({ ours: 0, theirs: 0 });
  });

  it("rejects future winners, missing side confirmation, and malformed totals", () => {
    expect(() =>
      buildVsCaptureCommit(
        weeklyReview({ weekStart: "2026-09-28", dayResults: [
          { day: 1, winner: "left" },
          { day: 2, winner: "unknown" },
          { day: 3, winner: "unknown" },
          { day: 4, winner: "unknown" },
          { day: 5, winner: "unknown" },
          { day: 6, winner: "unknown" },
        ] }),
        TODAY,
      ),
    ).toThrow(VsPerformanceError);
    expect(() =>
      buildVsCaptureCommit(weeklyReview({ confirmSides: false }), TODAY),
    ).toThrow();
    expect(() =>
      buildVsCaptureCommit(weeklyReview({ leftPoints: -1 }), TODAY),
    ).toThrow();
    expect(() =>
      buildVsCaptureCommit(weeklyReview({ leftPoints: 14 }), TODAY),
    ).toThrow();
  });
});

describe("mergeVsCaptureResults", () => {
  function head(recordedDate: string, ourScore: string, opponentScore: string, outcome: "won" | "lost" | "pending"): VsDayResult {
    return { recordedDate, totals: { ourScore, opponentScore }, outcome, finality: "final" };
  }
  function outcomeCommit(winners: Array<"left" | "right" | "unknown">, ours: number | null, theirs: number | null): VsCaptureCommit {
    return buildVsCaptureCommit(
      weeklyReview({
        dayResults: winners.map((winner, index) => ({ day: index + 1, winner })),
        leftPoints: ours,
        rightPoints: theirs,
      }),
      TODAY,
    );
  }

  it("keeps a pending 0/0 head valid with a 0/0 header without inventing a win", () => {
    const existing = [head("2026-09-21", "0", "0", "pending")];
    const capture = outcomeCommit(["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"], 0, 0);
    const merged = mergeVsCaptureResults(capture, existing, TODAY);
    expect(merged.days).toHaveLength(0);
    expect(merged.weeklyPoints).toEqual({ ours: 0, theirs: 0 });
  });

  it("keeps authoritative totals on an outcome-only capture that agrees", () => {
    const existing = [head("2026-09-21", "100", "50", "won")];
    const capture = outcomeCommit(["left", "unknown", "unknown", "unknown", "unknown", "unknown"], null, null);
    const merged = mergeVsCaptureResults(capture, existing, TODAY);
    expect(merged.days).toHaveLength(1);
    expect(merged.days[0]).toMatchObject({
      recordedDate: "2026-09-21",
      outcome: "won",
      totals: { ourScore: "100", opponentScore: "50" },
    });
  });

  it("rejects an outcome contradicting existing paired totals without change", () => {
    const existing = [head("2026-09-21", "100", "50", "won")];
    const capture = outcomeCommit(["right", "unknown", "unknown", "unknown", "unknown", "unknown"], null, null);
    expect(() => mergeVsCaptureResults(capture, existing, TODAY)).toThrowError(
      expect.objectContaining({ code: "capture_point_mismatch" }),
    );
  });

  it("leaves existing heads untouched for unknown capture days", () => {
    const existing = [head("2026-09-22", "80", "20", "won")];
    const capture = outcomeCommit(["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"], null, null);
    const merged = mergeVsCaptureResults(capture, existing, TODAY);
    expect(merged.days.find((d) => d.recordedDate === "2026-09-22")).toBeUndefined();
  });
});
