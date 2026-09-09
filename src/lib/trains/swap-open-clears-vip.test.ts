import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  getMemberRankAsOf: vi.fn(),
  swapConductorAssignmentsAtomic: vi.fn(),
  getServerCalendarDate: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  markPoolMemberSelectedForDate: vi.fn(),
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
    swapConductorAssignmentsAtomic: mocks.swapConductorAssignmentsAtomic,
  };
});

vi.mock("@/lib/trains/pool", () => ({
  markPoolMemberSelectedForDate: mocks.markPoolMemberSelectedForDate,
  movePoolSelectionForDate: vi.fn(),
  releasePoolSelectionForDate: vi.fn(),
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

describe("swapConductors atomic delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "S1" });
    mocks.getServerCalendarDate.mockReturnValue("2026-06-09");
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.resolveRollDayConfig.mockResolvedValue({
      paintTemplate: "tpif_with_replacement",
      conductorMechanism: "tpif_with_replacement",
    });
    mocks.markPoolMemberSelectedForDate.mockResolvedValue(undefined);
  });

  it("open-moves through one atomic transaction with null target member", async () => {
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        vipMemberId: "m9",
        lockedAt: null,
      })
      .mockResolvedValueOnce(null);

    mocks.swapConductorAssignmentsAtomic.mockResolvedValue({
      recordA: {
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: null,
        conductorMemberName: null,
        vipMemberId: null,
        lockedAt: null,
      },
      recordB: {
        id: "rec-b",
        date: "2026-06-12",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      },
    });

    await swapConductors({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
    });

    expect(mocks.swapConductorAssignmentsAtomic).toHaveBeenCalledWith({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
      seasonKey: "S1",
      expectedMemberA: { id: "m1", name: "Alice" },
      expectedMemberB: null,
      rankEventIdForA: null,
      rankEventIdForB: "rank-1",
    });
  });

  it("mutual swaps pass both members for CAS inside the transaction", async () => {
    mocks.getConductorRecord
      .mockResolvedValueOnce({
        id: "rec-a",
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      })
      .mockResolvedValueOnce({
        id: "rec-b",
        date: "2026-06-12",
        conductorMemberId: "m2",
        conductorMemberName: "Bob",
        lockedAt: null,
      });

    mocks.swapConductorAssignmentsAtomic.mockResolvedValue({
      recordA: {
        id: "rec-a",
        conductorMemberId: "m2",
        conductorMemberName: "Bob",
        lockedAt: null,
      },
      recordB: {
        id: "rec-b",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      },
    });

    await swapConductors({
      allianceId: "ally-1",
      dateA: "2026-06-10",
      dateB: "2026-06-12",
    });

    expect(mocks.swapConductorAssignmentsAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMemberA: { id: "m1", name: "Alice" },
        expectedMemberB: { id: "m2", name: "Bob" },
        rankEventIdForA: "rank-1",
        rankEventIdForB: "rank-1",
      }),
    );
  });
});
