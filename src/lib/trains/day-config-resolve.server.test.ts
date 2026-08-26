import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWeekSchedule: vi.fn(),
  listDayConfigsForWeek: vi.fn(),
  loadAllianceRow: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  getWeekSchedule: mocks.getWeekSchedule,
  listDayConfigsForWeek: mocks.listDayConfigsForWeek,
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: mocks.loadAllianceRow,
}));

import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";

describe("resolveRollDayConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAllianceRow.mockResolvedValue({ trainWeekStartDow: 2 });
    mocks.getWeekSchedule.mockResolvedValue({
      templateType: "vs_push_week",
    });
  });

  it("maps painted r4_event_vip overrides to r4_sequence even when stored mechanism is r3_lottery", async () => {
    mocks.listDayConfigsForWeek.mockResolvedValue([
      {
        id: "day-1",
        date: "2026-08-16",
        conductorMechanism: "r3_lottery",
        conductorConfig: { paintTemplate: "r4_event_vip" },
        vipMechanism: "event_top_x_lottery",
        vipConfig: { topN: 10 },
        isOverride: 1,
      },
    ]);

    const resolved = await resolveRollDayConfig("ally-1", "2026-08-16", "S1");

    expect(resolved.conductorMechanism).toBe("r4_sequence");
    expect(resolved.paintTemplate).toBe("r4_event_vip");
  });
});
