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
    expect(style).toContain("bg-red-500/15");
    expect(style).toContain("light:bg-red-100");
  });

  it("uses cyan styling for price_is_right paint", () => {
    const style = calendarCellStyleClass("r3_lottery", "price_is_right");
    expect(style).toContain("cyan");
    expect(style).toContain("bg-cyan-500/15");
    expect(style).toContain("light:bg-cyan-100");
  });

  it("uses emerald for r3_recognition paint", () => {
    const style = calendarCellStyleClass("r3_lottery", "r3_recognition");
    expect(style).toContain("emerald");
    expect(style).toContain("bg-emerald-500/15");
    expect(style).toContain("light:bg-emerald-100");
  });

  it("uses silvery styling for r4_event_vip segment paint", () => {
    const style = calendarCellStyleClass("r4_sequence", "r4_event_vip");
    expect(style).toContain("slate");
    expect(style).toContain("bg-slate-400/15");
    expect(style).toContain("light:bg-slate-100");
  });

  it("falls back to mechanism when vs_push_week is the paint template", () => {
    expect(calendarCellStyleClass("vs_top_10", "vs_push_week")).toContain(
      "blue",
    );
    expect(calendarCellStyleClass("vs_top_10", "vs_push_week")).toContain(
      "light:bg-blue-100",
    );
  });

  it("falls back to mechanism without a paint template", () => {
    expect(calendarCellStyleClass("donations_top", null)).toContain("amber");
    expect(calendarCellStyleClass("donations_top", null)).toContain(
      "light:bg-amber-100",
    );
  });
});

describe("calendarCellOpaqueStyleClass", () => {
  it("replaces translucent mechanism fill with a solid surface", () => {
    const style = calendarCellOpaqueStyleClass("r4_sequence", "r4_train_week");
    expect(style).toContain("bg-hq-surface");
    expect(style).not.toMatch(/bg-\S+\/\d+/);
    expect(style).not.toContain("light:bg-");
    expect(style).not.toContain("dark:");
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
