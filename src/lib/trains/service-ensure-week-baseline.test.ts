import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWeekSchedule: vi.fn(),
  upsertWeekSchedule: vi.fn(),
  replaceDayConfigs: vi.fn(),
  resolveAnchorTemplateType: vi.fn(),
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
  resolveAnchorTemplateType: mocks.resolveAnchorTemplateType,
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
    mocks.resolveAnchorTemplateType.mockResolvedValue("economy_week");
    mocks.getWeekSchedule.mockResolvedValue(null);
    mocks.upsertWeekSchedule.mockResolvedValue({
      id: "sched-1",
      templateType: "economy_week",
    });
  });

  it("creates a schedule row without bulk-seeding day configs", async () => {
    await ensureWeekScheduleBaseline("alliance-1", "2026-08-11");

    expect(mocks.resolveAnchorTemplateType).toHaveBeenCalledWith(
      "alliance-1",
      "2026-s1",
    );
    expect(mocks.upsertWeekSchedule).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      weekStart: "2026-08-11",
      templateType: "economy_week",
      seasonKey: "2026-s1",
    });
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });

  it("uses a preferred template when materializing a draft week", async () => {
    await ensureWeekScheduleBaseline(
      "alliance-1",
      "2026-08-11",
      "economy_week",
    );

    expect(mocks.resolveAnchorTemplateType).not.toHaveBeenCalled();
    expect(mocks.upsertWeekSchedule).toHaveBeenCalledWith({
      allianceId: "alliance-1",
      weekStart: "2026-08-11",
      templateType: "economy_week",
      seasonKey: "2026-s1",
    });
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });

  it("does nothing when the week schedule already exists", async () => {
    mocks.getWeekSchedule.mockResolvedValue({
      id: "sched-existing",
      templateType: "economy_week",
    });

    await ensureWeekScheduleBaseline("alliance-1", "2026-08-11");

    expect(mocks.upsertWeekSchedule).not.toHaveBeenCalled();
    expect(mocks.replaceDayConfigs).not.toHaveBeenCalled();
  });
});
