import { describe, expect, it } from "vitest";

import {
  vsDayNumberFromWeekdayIndex,
  vsScoreContextForTrainDate,
  vsScoreReferenceDate,
} from "@/lib/trains/vs-week-days.shared";

describe("vsDayNumberFromWeekdayIndex", () => {
  it("maps Mon–Sat to VS days 1–6", () => {
    expect(vsDayNumberFromWeekdayIndex(0)).toBe(1);
    expect(vsDayNumberFromWeekdayIndex(4)).toBe(5);
    expect(vsDayNumberFromWeekdayIndex(5)).toBe(6);
    expect(vsDayNumberFromWeekdayIndex(6)).toBeNull();
  });
});

describe("vsScoreContextForTrainDate", () => {
  it("uses T-1 scores and VS day name for Saturday train days", () => {
    const ctx = vsScoreContextForTrainDate("2026-06-13");
    expect(vsScoreReferenceDate("2026-06-13")).toBe("2026-06-12");
    expect(ctx.scoreDate).toBe("2026-06-12");
    expect(ctx.vsDayNumber).toBe(5);
    expect(ctx.vsDayKey).toBe("totalMobilization");
  });

  it("maps Sunday train days to Saturday Buster Day scores", () => {
    const ctx = vsScoreContextForTrainDate("2026-06-14");
    expect(ctx.scoreDate).toBe("2026-06-13");
    expect(ctx.vsDayNumber).toBe(6);
    expect(ctx.vsDayKey).toBe("busterDay");
  });
});
