import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadTimeOffAvailability: vi.fn(),
  getEffectiveSeasonForAlliance: vi.fn(),
  getConductorRecord: vi.fn(),
  resolveRollDayConfig: vi.fn(),
  countAllianceVrReporters: vi.fn(),
  fetchNativeVrTopScorers: vi.fn(),
  loadAllianceTrainLeadTimeDays: vi.fn(),
}));

vi.mock("@/lib/time-off/availability.server", () => ({ loadTimeOffAvailability: mocks.loadTimeOffAvailability }));

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
  };
});

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveRollDayConfig: mocks.resolveRollDayConfig,
}));

vi.mock("@/lib/trains/vr-reporter-count.server", () => ({
  countAllianceVrReporters: mocks.countAllianceVrReporters,
}));

vi.mock("@/lib/trains/native-scores.server", () => ({
  fetchNativeVrTopScorers: mocks.fetchNativeVrTopScorers,
}));

vi.mock("@/lib/trains/day-spin-exclusions.server", () => ({
  listDaySpinExcludedMemberIds: vi.fn(async () => []),
  recordDaySpinExclusion: vi.fn(async () => undefined),
}));

vi.mock("@/lib/trains/game-time", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trains/game-time")>();
  return {
    ...actual,
    getServerCalendarDate: () => "2099-06-15",
  };
});

import { TrainRollError } from "@/lib/trains/roll-errors.server";
import { rollForConductor } from "@/lib/trains/service";

describe("rollForConductor VR top board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveSeasonForAlliance.mockResolvedValue({ seasonKey: "3" });
    mocks.loadAllianceTrainLeadTimeDays.mockResolvedValue(0);
    mocks.getConductorRecord.mockResolvedValue(null);
    mocks.resolveRollDayConfig.mockResolvedValue({
      conductorMechanism: "vr_top_n",
      conductorConfig: { topN: 5 },
      vipMechanism: "none",
      dayConfigId: "dc1",
    });
    mocks.countAllianceVrReporters.mockResolvedValue(10);
  });

  it("does not draw an away member from an otherwise complete VR board", async () => {
    const top = Array.from({ length: 5 }, (_, index) => ({ memberId: `m${index}`, memberName: `Member ${index}` }));
    mocks.fetchNativeVrTopScorers.mockResolvedValue(top);
    mocks.loadTimeOffAvailability.mockResolvedValue({ awayMemberIds: new Set(top.map((candidate) => candidate.memberId)) });
    await expect(rollForConductor({ allianceId: "a1", date: "2099-06-20" })).rejects.toMatchObject({ details: { code: "POOL_UNAVAILABLE" } });
    expect(mocks.loadTimeOffAvailability).toHaveBeenCalledWith("a1", "2099-06-20");
  });

  it("fails closed when the active-roster board is shorter than scope N", async () => {
    mocks.fetchNativeVrTopScorers.mockResolvedValue([
      {
        memberId: "m1",
        memberName: "Alpha",
        allianceRank: 4,
        priorDayVsScore: 120,
      },
      {
        memberId: "m2",
        memberName: "Beta",
        allianceRank: 3,
        priorDayVsScore: 90,
      },
    ]);

    await expect(
      rollForConductor({ allianceId: "a1", date: "2099-06-20" }),
    ).rejects.toMatchObject({
      name: "TrainRollError",
      message:
        "Only 2 of 5 active-roster VR standings available for Top 5.",
      details: { code: "NO_WHEEL_CANDIDATES", candidateKind: "vr" },
    } satisfies Partial<TrainRollError>);
  });
});
