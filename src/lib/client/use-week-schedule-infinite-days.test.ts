import { describe, expect, it } from "vitest";

import { weekRangeForDate } from "@/lib/client/use-week-schedule-infinite-days";
import { DEFAULT_ALLIANCE_TRAIN_WEEK } from "@/lib/trains/train-week-calendar.shared";

describe("weekRangeForDate", () => {
  it("uses alliance train week boundaries (Tuesday start by default)", () => {
    expect(weekRangeForDate("2026-06-20", DEFAULT_ALLIANCE_TRAIN_WEEK)).toEqual({
      weekStart: "2026-06-16",
      weekEnd: "2026-06-22",
    });
  });

  it("does not snap forward navigation to the same Monday-based week", () => {
    const nextWeekStart = weekRangeForDate(
      "2026-06-23",
      DEFAULT_ALLIANCE_TRAIN_WEEK,
    ).weekStart;
    expect(nextWeekStart).toBe("2026-06-23");
    expect(nextWeekStart).not.toBe("2026-06-16");
  });
});
