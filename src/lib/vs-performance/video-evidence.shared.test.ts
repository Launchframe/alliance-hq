import { describe, expect, it } from "vitest";

import { compareVsVideoTotals, vsVideoContextSchema, vsVideoScreenshotContextMatches, vsVideoWeekStart } from "./video-evidence.shared";

describe("VS video screenshot comparison", () => {
  it.each([
    ["10000", "10000", "match", "0", "equal"],
    ["10000", "9901", "fine", "0", "shortfall"],
    ["10000", "10100", "warning", "1", "excess"],
    ["10000", "9900", "warning", "1", "shortfall"],
    ["10000", "9501", "warning", "4", "shortfall"],
    ["10000", "9500", "danger", "5", "shortfall"],
    ["10000", "10500", "danger", "5", "excess"],
    ["100", "80", "danger", "20", "shortfall"],
    ["3", "2", "danger", "33", "shortfall"],
    ["0", "0", "match", "0", "equal"],
    ["0", "1", "danger", null, "excess"],
  ])("compares %s against %s without rounding severity", (reference, video, state, percentFloor, direction) => {
    expect(compareVsVideoTotals(reference, [video])).toMatchObject({ state, percentFloor, direction, videoTotal: video });
  });

  it("adds safe individual scores exactly beyond Number.MAX_SAFE_INTEGER", () => {
    expect(compareVsVideoTotals("18014398509481982", ["9007199254740991", "9007199254740991"])).toMatchObject({ state: "match", videoTotal: "18014398509481982", difference: "0", percentFloor: "0" });
  });

  it("uses the same individual score parser as submission", () => {
    expect(compareVsVideoTotals("3000", ["1,000", "2.000"])).toMatchObject({ state: "match", videoTotal: "3000" });
  });

  it("does not turn absent or incomplete evidence into zero", () => {
    expect(compareVsVideoTotals(null, [100])).toMatchObject({ state: "unavailable", videoTotal: "100", percentFloor: null });
    expect(compareVsVideoTotals("0", [])).toMatchObject({ state: "incomplete", videoTotal: null });
    expect(compareVsVideoTotals("100", [100], false).state).toBe("incomplete");
    for (const score of [null, "", "invalid", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(compareVsVideoTotals("100", [score]).state).toBe("incomplete");
    }
  });
});

describe("VS video screenshot context", () => {
  const daily = { recordedDate: "2026-09-29", period: "daily" as const };
  const weekly = { recordedDate: "2026-10-04", period: "weekly" as const };
  it("uses the same Monday for a daily date and its week-ending Sunday", () => {
    expect(vsVideoWeekStart(daily)).toBe("2026-09-28");
    expect(vsVideoWeekStart(weekly)).toBe("2026-09-28");
  });
  it("rejects invalid dates and invalid periods", () => {
    expect(vsVideoContextSchema.safeParse({ recordedDate: "2026-02-30", period: "daily" }).success).toBe(false);
    expect(vsVideoContextSchema.safeParse({ recordedDate: "2026-10-04", period: "daily" }).success).toBe(false);
    expect(vsVideoContextSchema.safeParse({ recordedDate: "2026-09-29", period: "weekly" }).success).toBe(false);
  });
  it("never compares a daily screenshot with another day or a weekly video", () => {
    const review = { kind: "daily_totals" as const, weekStart: "2026-09-28", day: 2 };
    expect(vsVideoScreenshotContextMatches(daily, review)).toBe(true);
    expect(vsVideoScreenshotContextMatches(weekly, review)).toBe(false);
    expect(vsVideoScreenshotContextMatches(daily, { ...review, day: 3 })).toBe(false);
    expect(vsVideoScreenshotContextMatches(daily, { ...review, weekStart: "2026-09-21" })).toBe(false);
    expect(vsVideoScreenshotContextMatches(daily, { kind: "weekly_overview", weekStart: "2026-09-28" })).toBe(true);
  });
  it("accepts a context carrying full evidence view fields", () => {
    const fullEvidenceView = {
      ...daily,
      version: 3,
      imageVersion: 2,
      requestedKind: "auto",
      status: "ready",
      fileName: "shot.png",
      candidate: { kind: "daily_totals" },
      errorCode: null,
      draft: null,
      appliedImageVersion: null,
      previewUrl: "/x",
    };
    const review = { kind: "daily_totals" as const, weekStart: "2026-09-28", day: 2 };
    expect(vsVideoScreenshotContextMatches(fullEvidenceView as typeof daily, review)).toBe(true);
  });
});
