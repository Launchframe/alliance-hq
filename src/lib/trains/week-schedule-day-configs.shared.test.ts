import { describe, expect, it } from "vitest";

import { buildWeekScheduleDayConfigs } from "@/lib/trains/week-schedule-day-configs.shared";

describe("buildWeekScheduleDayConfigs", () => {
  it("returns seven Tuesday-start days when DB rows lag by one day after week_start migration", () => {
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
});
