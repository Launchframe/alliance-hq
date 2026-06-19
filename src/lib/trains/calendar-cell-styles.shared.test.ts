import { describe, expect, it } from "vitest";

import {
  calendarCellOpaqueStyleClass,
  calendarCellStyleClass,
  paintTemplateFromConductorConfig,
} from "@/lib/trains/calendar-cell-styles.shared";

describe("calendarCellStyleClass", () => {
  it("uses red styling for economy_week paint despite r3_lottery mechanism", () => {
    const style = calendarCellStyleClass("r3_lottery", "economy_week");
    expect(style).toContain("red");
    expect(style).not.toContain("emerald");
  });

  it("uses emerald for r3_recognition paint", () => {
    const style = calendarCellStyleClass("r3_lottery", "r3_recognition");
    expect(style).toContain("emerald");
  });

  it("uses silvery styling for r4_event_vip segment paint", () => {
    const style = calendarCellStyleClass("r4_sequence", "r4_event_vip");
    expect(style).toContain("slate");
  });

  it("falls back to mechanism when vs_push_week is the paint template", () => {
    expect(calendarCellStyleClass("vs_top_10", "vs_push_week")).toContain(
      "blue",
    );
  });

  it("falls back to mechanism without a paint template", () => {
    expect(calendarCellStyleClass("donations_top", null)).toContain("amber");
  });
});

describe("calendarCellOpaqueStyleClass", () => {
  it("replaces translucent mechanism fill with a solid surface", () => {
    const style = calendarCellOpaqueStyleClass("r4_sequence", "r4_train_week");
    expect(style).toContain("bg-[#161b22]");
    expect(style).not.toMatch(/bg-\S+\/\d+/);
    expect(style).toContain("purple");
  });
});

describe("paintTemplateFromConductorConfig", () => {
  it("reads paintTemplate from conductor config JSON", () => {
    expect(
      paintTemplateFromConductorConfig({ paintTemplate: "economy_week" }),
    ).toBe("economy_week");
  });
});
