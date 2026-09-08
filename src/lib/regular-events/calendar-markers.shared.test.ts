import { describe, expect, it } from "vitest";

import { trimEmptyMonthGridWeeks } from "@/lib/regular-events/calendar-markers.shared";
import { buildMonthGrid } from "@/lib/trains/trains-display-calendar.shared";

describe("trimEmptyMonthGridWeeks", () => {
  it("drops a trailing week that is entirely outside the month", () => {
    // Sep 2026 Mon-start: 6 raw weeks; last week is Oct 5–11 only.
    const raw = buildMonthGrid("2026-09", 1);
    expect(raw).toHaveLength(42);
    const trimmed = trimEmptyMonthGridWeeks(raw);
    expect(trimmed).toHaveLength(35);
    expect(trimmed.every((c) => !c.date.startsWith("2026-10-0") || c.date <= "2026-10-04")).toBe(
      true,
    );
    expect(trimmed.some((c) => c.date === "2026-10-05")).toBe(false);
    expect(trimmed.some((c) => c.date === "2026-09-01")).toBe(true);
    expect(trimmed.some((c) => c.date === "2026-08-31")).toBe(true);
  });

  it("keeps a leading partial week when the month does not start on Monday", () => {
    const trimmed = trimEmptyMonthGridWeeks(buildMonthGrid("2026-09", 1));
    expect(trimmed[0]?.date).toBe("2026-08-31");
    expect(trimmed[0]?.inMonth).toBe(false);
  });
});
