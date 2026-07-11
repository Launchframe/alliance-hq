import { describe, expect, it } from "vitest";

import {
  buildWeekScheduleDayConfigs,
  isProvisionalDayConfig,
  provisionalDayConfigClass,
  resolveWeekDisplayDayConfigs,
} from "@/lib/trains/week-schedule-day-configs.shared";

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
      "vs_push_week",
      [],
    );

    expect(configs).toHaveLength(7);
    expect(configs.every((day) => isProvisionalDayConfig(day.id))).toBe(true);
  });
});

describe("buildWeekScheduleDayConfigs", () => {
  it("remaps stored Saturday price_is_right days to heavy_hitter_lottery", () => {
    const configs = buildWeekScheduleDayConfigs("2026-06-09", "price_is_right", [
      {
        id: "sat",
        date: "2026-06-13",
        conductorMechanism: "r3_lottery",
        conductorConfig: { paintTemplate: "price_is_right" },
        vipMechanism: "conductor_pick",
        vipConfig: null,
      },
    ]);
    const saturday = configs.find((day) => day.date === "2026-06-13");
    expect(saturday?.conductorMechanism).toBe("heavy_hitter_lottery");
  });

  it("returns seven days when DB has six rows and the last day is missing", () => {
    const weekStart = "2026-06-16";
    const rows = [
      {
        id: "dc-1",
        date: "2026-06-16",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
      {
        id: "dc-2",
        date: "2026-06-17",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
      {
        id: "dc-3",
        date: "2026-06-18",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
      {
        id: "dc-4",
        date: "2026-06-19",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
      {
        id: "dc-5",
        date: "2026-06-20",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
      {
        id: "dc-6",
        date: "2026-06-21",
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      },
    ];

    const configs = buildWeekScheduleDayConfigs(
      weekStart,
      "vs_push_week",
      rows,
    );

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
    const rows = Array.from({ length: 7 }, (_, index) => {
      const day = index + 16;
      return {
        id: `dc-${index + 1}`,
        date: `2026-06-${String(day).padStart(2, "0")}`,
        conductorMechanism: "r3_lottery",
        vipMechanism: "conductor_pick",
        vipConfig: null,
        isOverride: 0,
      };
    });

    const configs = buildWeekScheduleDayConfigs(
      weekStart,
      "vs_push_week",
      rows,
    );

    expect(configs).toHaveLength(7);
    expect(configs.every((day) => !day.id.startsWith("preview-"))).toBe(true);
  });
});
