import { describe, expect, it } from "vitest";

import {
  buildWeekScheduleDayConfigs,
  isProvisionalDayConfig,
  provisionalDayConfigClass,
  resolveWeekDisplayDayConfigs,
  constantFillTemplate,
} from "@/lib/trains/week-schedule-day-configs.shared";
import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";

const VS_PUSH = constantFillTemplate({
  id: "tmpl-vs-push",
  days: PRESET_WEEK_RULES.vs_push_week,
});
const PIF = constantFillTemplate({
  id: "tmpl-pif",
  days: PRESET_WEEK_RULES.price_is_right,
});
/** A week with no schedule row fills as free choice, not an invented preset. */
const NO_TEMPLATE = constantFillTemplate({
  id: null,
  days: PRESET_WEEK_RULES.custom,
});

const R3_WHEEL_ROW = {
  conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
  vipRule: null,
  isOverride: 0,
};

describe("isProvisionalDayConfig", () => {
  it("returns true for preview ids", () => {
    expect(isProvisionalDayConfig("preview-2026-06-16")).toBe(true);
  });

  it("returns false for persisted ids", () => {
    expect(isProvisionalDayConfig("dc-1")).toBe(false);
  });
});

describe("provisionalDayConfigClass", () => {
  it("returns muted classes for provisional cells", () => {
    expect(provisionalDayConfigClass(true)).toContain("opacity-60");
    expect(provisionalDayConfigClass(false)).toBe("");
  });
});

describe("resolveWeekDisplayDayConfigs", () => {
  it("returns seven preview rows when no DB rows exist", () => {
    const configs = resolveWeekDisplayDayConfigs(
      "2026-06-16",
      NO_TEMPLATE,
      [],
    );

    expect(configs).toHaveLength(7);
    expect(configs.every((day) => isProvisionalDayConfig(day.id))).toBe(true);
  });

  it("fills preview days from the preset's calendar weekday rules", () => {
    const configs = resolveWeekDisplayDayConfigs(
      "2026-06-09",
      PIF,
      [],
    );
    // 2026-06-13 is a Saturday — the max-ticket draw.
    expect(
      configs.find((day) => day.date === "2026-06-13")?.conductorRule,
    ).toEqual({ kind: "price_is_freight", board: "heavy_hitter" });
    expect(
      configs.find((day) => day.date === "2026-06-10")?.conductorRule,
    ).toEqual({ kind: "price_is_freight", board: "weekday" });
  });
});

describe("buildWeekScheduleDayConfigs", () => {
  it("returns seven days when DB has six rows and the last day is missing", () => {
    const weekStart = "2026-06-16";
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `dc-${index + 1}`,
      date: `2026-06-${String(index + 16).padStart(2, "0")}`,
      ...R3_WHEEL_ROW,
    }));

    const configs = buildWeekScheduleDayConfigs(weekStart, VS_PUSH, rows);

    expect(configs).toHaveLength(7);
    expect(configs.map((day) => day.date)).toEqual([
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20",
      "2026-06-21",
      "2026-06-22",
    ]);
    expect(configs[6]?.id).toBe("preview-2026-06-22");
    expect(configs[0]?.id).toBe("dc-1");
  });

  it("uses persisted rows only when all seven days exist in DB", () => {
    const weekStart = "2026-06-16";
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: `dc-${index + 1}`,
      date: `2026-06-${String(index + 16).padStart(2, "0")}`,
      ...R3_WHEEL_ROW,
    }));

    const configs = buildWeekScheduleDayConfigs(weekStart, VS_PUSH, rows);

    expect(configs).toHaveLength(7);
    expect(configs.every((day) => !day.id.startsWith("preview-"))).toBe(true);
  });

  it("keeps a persisted rule even when the row is not an override", () => {
    // Regression: the week preset used to overwrite non-override rows, so any
    // baseline / import path that left is_override = 0 displayed the preset
    // instead of the rule actually stored for that day.
    const configs = buildWeekScheduleDayConfigs("2026-06-16", PIF, [
      {
        id: "wed",
        date: "2026-06-18",
        conductorRule: { kind: "vs_top_n", topN: 10 },
        vipRule: null,
        isOverride: 0,
      },
    ]);
    const wednesday = configs.find((day) => day.date === "2026-06-18");
    expect(wednesday?.conductorRule).toEqual({ kind: "vs_top_n", topN: 10 });
    expect(wednesday?.id).toBe("wed");
  });

  it("treats an unparseable stored rule as free choice", () => {
    const configs = buildWeekScheduleDayConfigs("2026-06-16", VS_PUSH, [
      {
        id: "mon",
        date: "2026-06-16",
        conductorRule: { kind: "vs_push_weekdays" },
        vipRule: null,
        isOverride: 1,
      },
    ]);
    expect(
      configs.find((day) => day.date === "2026-06-16")?.conductorRule,
    ).toBeNull();
  });
});
