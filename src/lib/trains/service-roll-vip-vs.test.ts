import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeOffAvailability: vi.fn(),
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  assignVipOnLockedConductor: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
  loadAllianceTrainLeadTimeDays: vi.fn(),
  getMemberRankAsOf: vi.fn(),
}));

vi.mock("@/lib/time-off/availability.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/time-off/availability.server")>();
  return { ...actual, loadTimeOffAvailability: mocks.loadTimeOffAvailability };
});

vi.mock("@/lib/game-season/sync", () => ({
  getEffectiveSeasonForAlliance: mocks.getEffectiveSeasonForAlliance,
}));

vi.mock("@/lib/trains/alliance-train-lead-time.server", () => ({
  loadAllianceTrainLeadTimeDays: mocks.loadAllianceTrainLeadTimeDays,
}));

vi.mock("@/lib/trains/repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/repository")>();
  return {
    ...actual,
    getConductorRecord: mocks.getConductorRecord,
    assignVipOnLockedConductor: mocks.assignVipOnLockedConductor,
  };
});

vi.mock("@/lib/trains/rank-history", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/rank-history")>();
  return { ...actual, getMemberRankAsOf: mocks.getMemberRankAsOf };
});

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsTopScorersForTrainDate:
    mocks.fetchAllianceVsTopScorersForTrainDate,
}));

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return { ...actual, getServerCalendarDate: () => "2099-06-15" };
});

import { rollForVip } from "@/lib/trains/service";

const board = [
  { memberId: "cond", memberName: "Conductor", priorDayVsScore: 12_000_000 },
  { memberId: "a", memberName: "Alpha", priorDayVsScore: 9_000_000 },
  { memberId: "b", memberName: "Beta", priorDayVsScore: 7_500_000 },
  { memberId: "c", memberName: "Gamma", priorDayVsScore: 3_000_000 },
];

function useVipRule(vipRule: unknown) {
  mocks.resolveRollDayConfig.mockResolvedValue({
    conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
    vipRule,
    dayConfigId: "dc1",
  });
}

describe("rollForVip VS rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(1);
    mocks.getConductorRecord.mockResolvedValue({
      lockedAt: new Date("2099-06-19T00:00:00Z"),
      conductorMemberId: "cond",
    });
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue(board);
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set() });
    mocks.getMemberRankAsOf.mockResolvedValue({ id: "rank-1" });
    mocks.assignVipOnLockedConductor.mockResolvedValue({});
  });

  it("assigns Top 1 to the best non-conductor without a wheel", async () => {
    useVipRule({ kind: "vs_top_n", topN: 1 });

    const result = await rollForVip({ allianceId: "a1", date: "2099-06-20" });

    expect(mocks.fetchAllianceVsTopScorersForTrainDate).toHaveBeenCalledWith(
      "a1",
      "2099-06-20",
      expect.any(Number),
      1,
    );
    expect(result).toMatchObject({
      memberId: "a",
      isAutomatic: true,
      mechanism: "vs_top_n",
      draftPersisted: true,
    });
    expect(mocks.assignVipOnLockedConductor).toHaveBeenCalledWith(
      expect.objectContaining({
        allianceId: "a1",
        date: "2099-06-20",
        vipMemberId: "a",
        vipMemberName: "Alpha",
        vipRankEventId: "rank-1",
        vipMechanism: "vs_top_n",
        vipRule: { kind: "vs_top_n", topN: 1 },
        dayConfigId: "dc1",
      }),
    );
  });

  it("spins the threshold wheel over non-conductors above the minimum", async () => {
    useVipRule({ kind: "vs_min_score", minScore: 7_000_000 });

    const result = await rollForVip({ allianceId: "a1", date: "2099-06-20" });

    expect(result.isAutomatic).toBe(false);
    expect(result.wheelCandidates?.map((c) => c.memberId)).toEqual(["a", "b"]);
    expect(["a", "b"]).toContain(result.memberId);
    expect(mocks.assignVipOnLockedConductor).toHaveBeenCalledWith(
      expect.objectContaining({
        vipMemberId: result.memberId,
        vipMechanism: "vs_min_score",
      }),
    );
  });

  it("skips members on time off and persists nothing when none remain", async () => {
    useVipRule({ kind: "vs_min_score", minScore: 7_000_000 });
    mocks.loadTimeOffAvailability.mockResolvedValue({
      awayMemberIds: new Set(["a", "b"]),
    });

    await expect(
      rollForVip({ allianceId: "a1", date: "2099-06-20" }),
    ).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });
    expect(mocks.assignVipOnLockedConductor).not.toHaveBeenCalled();
  });

  it("reports no candidates when only the conductor clears the threshold", async () => {
    useVipRule({ kind: "vs_min_score", minScore: 10_000_000 });

    await expect(
      rollForVip({ allianceId: "a1", date: "2099-06-20" }),
    ).rejects.toMatchObject({
      details: { code: "NO_WHEEL_CANDIDATES", candidateKind: "vs" },
    });
    expect(mocks.assignVipOnLockedConductor).not.toHaveBeenCalled();
  });
});
