import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";
import { generateWeekDayConfigs } from "@/lib/trains/templates";

describe("train game-time", () => {
  it("maps UTC instant to server calendar date", () => {
    expect(
      getServerCalendarDate(new Date("2026-06-11T01:30:00.000Z")),
    ).toBe("2026-06-10");
    expect(
      getServerCalendarDate(new Date("2026-06-11T02:30:00.000Z")),
    ).toBe("2026-06-11");
  });

  it("finds Monday week start", () => {
    expect(getWeekStartMonday("2026-06-11")).toBe("2026-06-08");
    expect(getWeekStartMonday("2026-06-15")).toBe("2026-06-15");
  });

  it("adds calendar days in server time", () => {
    expect(addCalendarDays("2026-06-11", 1)).toBe("2026-06-12");
  });
});

describe("vs_push_week template", () => {
  it("assigns mechanisms across the week", () => {
    const weekStart = "2026-06-08";
    const configs = generateWeekDayConfigs("vs_push_week", weekStart);
    expect(configs).toHaveLength(7);
    expect(configs[0]?.conductorMechanism).toBe("vs_high_score");
    expect(configs[1]?.conductorMechanism).toBe("vs_top_10");
    expect(configs[5]?.conductorMechanism).toBe("r4_sequence");
    expect(configs[5]?.vipMechanism).toBe("event_top_x_lottery");
    expect(configs[6]?.vipMechanism).toBe("event_top_x_lottery");
  });
});
