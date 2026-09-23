import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWeekSchedule: vi.fn(),
  upsertWeekSchedule: vi.fn(),
  replaceDayConfigs: vi.fn(),
}));

vi.mock("@/lib/trains/repository", () => ({
  clearConductorAssignment: vi.fn(),
  clearVipAssignment: vi.fn(),
  getConductorRecord: vi.fn(),
  getWeekSchedule: mocks.getWeekSchedule,
  replaceDayConfigs: mocks.replaceDayConfigs,
  upsertDayConfigOverride: vi.fn(),
  upsertWeekSchedule: mocks.upsertWeekSchedule,
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: vi.fn(async () => ({
    seasonKey: "2026-s1",
  })),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: vi.fn(),
}));

import { ensureWeekScheduleBaseline } from "@/lib/trains/service";

describe("ensureWeekScheduleBaseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getWeekSchedule.mockResolvedValue(null);
    mocks.upsertWeekSchedule.mockResolvedValue({
      id: "sched-1",
      templateId: "tmpl-economy",
    });
  });

  it("creates a schedule row with no template rather than inventing one", async () => {
    // Painting one day must not declare a preset for the other six.
    await ensureWeekScheduleBaseline("alliance-1", "2026-08-11");

    expect(mocks.upsertWeekSchedule).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      weekStart: "2026-08-11",
      templateId: null,
      seasonKey: "2026-s1",
    });
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });

  it("uses a preferred template when materializing a draft week", async () => {
    await ensureWeekScheduleBaseline(
      "alliance-1",
      "2026-08-11",
      "tmpl-economy",
    );

    expect(mocks.upsertWeekSchedule).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      weekStart: "2026-08-11",
      templateId: "tmpl-economy",
      seasonKey: "2026-s1",
    });
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });

  it("does nothing when the week schedule already exists", async () => {
    mocks.getWeekSchedule.mockResolvedValue({
      id: "sched-existing",
      templateId: "tmpl-economy",
    });

    await ensureWeekScheduleBaseline("alliance-1", "2026-08-11");

    expect(mocks.upsertWeekSchedule).not.toHaveBeenCalled();
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });
});
