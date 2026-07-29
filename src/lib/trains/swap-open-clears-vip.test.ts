import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  upsertConductorDraft: vi.fn(),
  clearConductorAssignment: vi.fn(),
  clearVipAssignment: vi.fn(),
  lockConductorRecord: vi.fn(),
  getServerCalendarDate: vi.fn(),
  movePoolSelectionForDate: vi.fn(),
  resolveRollDayConfig: vi.fn(),
}));

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/rank-history", () => ({
  getMemberRankAsOf: mocks.getMemberRankAsOf,
}));

vi.mock("@/lib/trains/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trains/repository")>(
    "@/lib/trains/repository",
  );
  return {
    ...actual,
    getConductorRecord: mocks.getConductorRecord,
    upsertConductorDraft: mocks.upsertConductorDraft,
    clearConductorAssignment: mocks.clearConductorAssignment,
    clearVipAssignment: mocks.clearVipAssignment,
    lockConductorRecord: mocks.lockConductorRecord,
  };
});

vi.mock("@/lib/trains/pool", () => ({
  movePoolSelectionForDate: mocks.movePoolSelectionForDate,
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/game-time", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trains/game-time")>(
    "@/lib/trains/game-time",
  );
  return {
    ...actual,
    getServerCalendarDate: mocks.getServerCalendarDate,
  };
});

import { swapConductors } from "@/lib/trains/service";

describe("swapConductors open-target VIP clear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "S1" });
    mocks.getServerCalendarDate.mockReturnValue("2026-06-09");
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.upsertConductorDraft.mockResolvedValue(undefined);
    mocks.clearConductorAssignment.mockResolvedValue(undefined);
    mocks.clearVipAssignment.mockResolvedValue(undefined);
    mocks.movePoolSelectionForDate.mockResolvedValue(undefined);
    mocks.resolveRollDayConfig.mockResolvedValue({
      paintTemplate: "tpif_with_replacement",
      conductorMechanism: "tpif_with_replacement",
    });
    mocks.lockConductorRecord.mockImplementation(async (id: string) => ({
      id,
      lockedAt: new Date("2026-06-12T12:00:00.000Z"),
    }));
  });

  it("clears orphan VIP on the emptied source day", async () => {
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        vipMemberId: "m9",
        vipMemberName: "VIP Nine",
        lockedAt: null,
      })
      .mockResolvedValueOnce(null)
      // drafts after mutate
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: null,
        conductorMemberName: null,
        vipMemberId: null,
        lockedAt: null,
      })
      .mockResolvedValueOnce({
        id: "rec-b",
        date: "2026-06-12",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      });

    await swapConductors({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
    });

    expect(mocks.clearConductorAssignment).toHaveBeenCalledWith(
      "ally-1",
      "2026-06-10",
      "S1",
      { releasePool: false },
    );
    expect(mocks.clearVipAssignment).toHaveBeenCalledWith(
      "ally-1",
      "2026-06-10",
      "S1",
    );
  });

  it("skips VIP clear when source had no VIP", async () => {
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        vipMemberId: null,
        vipMemberName: null,
        lockedAt: null,
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: null,
        lockedAt: null,
      })
      .mockResolvedValueOnce({
        id: "rec-b",
        date: "2026-06-12",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      });

    await swapConductors({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
    });

    expect(mocks.clearVipAssignment).not.toHaveBeenCalled();
  });
});
