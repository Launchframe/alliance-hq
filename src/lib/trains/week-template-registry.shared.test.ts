import { describe, expect, it } from "vitest";

import {
  isWeekTemplateSegment,
  resolvePaintTemplateForDay,
  segmentTemplateForDayIndex,
  usesCombinedSegmentDisplay,
} from "@/lib/trains/week-template-registry.shared";

describe("week template registry", () => {
  it("marks segment templates that are not whole-week presets", () => {
    expect(isWeekTemplateSegment("r4_event_vip")).toBe(true);
    expect(isWeekTemplateSegment("price_is_right_weekdays")).toBe(true);
    expect(isWeekTemplateSegment("takedown_week")).toBe(false);
    expect(isWeekTemplateSegment("vs_push_week")).toBe(false);
  });

  it("maps vs_push_week composite days to segment templates (Tue-start train week)", () => {
    const weekStart = "2026-06-09";
    expect(segmentTemplateForDayIndex("vs_push_week", 0)).toBe("vs_push_weekdays");
    expect(segmentTemplateForDayIndex("vs_push_week", 3)).toBe("vs_push_weekdays");
    expect(segmentTemplateForDayIndex("vs_push_week", 4)).toBe("vs_push_weekdays");
    expect(segmentTemplateForDayIndex("vs_push_week", 5)).toBe("r4_event_vip");
    expect(segmentTemplateForDayIndex("vs_push_week", 6)).toBe("r4_event_vip");
    expect(resolvePaintTemplateForDay("vs_push_week", "2026-06-13", weekStart)).toBe(
      "vs_push_weekdays",
    );
    expect(resolvePaintTemplateForDay("vs_push_week", "2026-06-10", weekStart)).toBe(
      "vs_push_weekdays",
    );
    expect(resolvePaintTemplateForDay("vs_push_week", "2026-06-15", weekStart)).toBe(
      "r4_event_vip",
    );
  });

  it("returns the template itself for non-composite weeks", () => {
    expect(resolvePaintTemplateForDay("economy_week", "2026-06-10", "2026-06-09")).toBe(
      "economy_week",
    );
  });

  it("maps price_is_right composite days to weekday / takedown / custom segments", () => {
    const weekStart = "2026-06-09";
    expect(resolvePaintTemplateForDay("price_is_right", "2026-06-10", weekStart)).toBe(
      "price_is_right_weekdays",
    );
    expect(resolvePaintTemplateForDay("price_is_right", "2026-06-13", weekStart)).toBe(
      "takedown_week",
    );
    expect(resolvePaintTemplateForDay("price_is_right", "2026-06-14", weekStart)).toBe(
      "custom",
    );
    expect(resolvePaintTemplateForDay("price_is_right", "2026-06-15", weekStart)).toBe(
      "custom",
    );
  });

  it("uses combined segment labels for price is freight paints", () => {
    expect(usesCombinedSegmentDisplay("price_is_right")).toBe(true);
    expect(usesCombinedSegmentDisplay("price_is_right_weekdays")).toBe(true);
    expect(usesCombinedSegmentDisplay("takedown_week")).toBe(true);
    expect(usesCombinedSegmentDisplay("economy_week")).toBe(false);
  });
});
