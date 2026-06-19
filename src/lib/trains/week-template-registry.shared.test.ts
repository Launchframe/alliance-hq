import { describe, expect, it } from "vitest";

import {
  isWeekTemplateSegment,
  resolvePaintTemplateForDay,
  segmentTemplateForDayIndex,
} from "@/lib/trains/week-template-registry.shared";

describe("week template registry", () => {
  it("marks segment templates that are not whole-week presets", () => {
    expect(isWeekTemplateSegment("r4_event_vip")).toBe(true);
    expect(isWeekTemplateSegment("vs_push_week")).toBe(false);
  });

  it("maps vs_push_week composite days to segment templates", () => {
    const weekStart = "2026-06-08";
    expect(segmentTemplateForDayIndex("vs_push_week", 0)).toBe("vs_push_weekdays");
    expect(segmentTemplateForDayIndex("vs_push_week", 4)).toBe("vs_push_weekdays");
    expect(segmentTemplateForDayIndex("vs_push_week", 5)).toBe("r4_event_vip");
    expect(segmentTemplateForDayIndex("vs_push_week", 6)).toBe("r4_event_vip");
    expect(resolvePaintTemplateForDay("vs_push_week", "2026-06-13", weekStart)).toBe(
      "r4_event_vip",
    );
    expect(resolvePaintTemplateForDay("vs_push_week", "2026-06-10", weekStart)).toBe(
      "vs_push_weekdays",
    );
  });

  it("returns the template itself for non-composite weeks", () => {
    expect(resolvePaintTemplateForDay("economy_week", "2026-06-10", "2026-06-08")).toBe(
      "economy_week",
    );
  });
});
