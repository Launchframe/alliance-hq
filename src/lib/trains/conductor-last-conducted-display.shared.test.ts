import { describe, expect, it } from "vitest";

import { diffCalendarDays } from "@/lib/trains/calendar-date-diff.shared";
import { formatRelativeConductorLastConducted } from "@/lib/trains/conductor-last-conducted-display.shared";

const labels = {
  today: "today",
  yesterday: "yesterday",
  daysAgo: (n: number) => `${n} days ago`,
  weeksAgo: (n: number) => `${n} weeks ago`,
  monthsAgo: (n: number) => `${n} months ago`,
  yearsAgo: (n: number) => `${n} year${n === 1 ? "" : "s"} ago`,
  never: "never",
};

describe("diffCalendarDays", () => {
  it("counts whole calendar days between server dates", () => {
    expect(diffCalendarDays("2026-08-05", "2026-08-10")).toBe(5);
  });
});

describe("formatRelativeConductorLastConducted", () => {
  it("formats day, week, month, and year buckets", () => {
    expect(
      formatRelativeConductorLastConducted("2026-08-05", "2026-08-10", labels),
    ).toBe("5 days ago");
    expect(
      formatRelativeConductorLastConducted("2026-07-20", "2026-08-10", labels),
    ).toBe("3 weeks ago");
    expect(
      formatRelativeConductorLastConducted("2026-06-10", "2026-08-10", labels),
    ).toBe("2 months ago");
    expect(
      formatRelativeConductorLastConducted("2025-08-10", "2026-08-10", labels),
    ).toBe("1 year ago");
  });

  it("returns never when there is no prior conduct", () => {
    expect(formatRelativeConductorLastConducted(null, "2026-08-10", labels)).toBe(
      "never",
    );
  });
});
