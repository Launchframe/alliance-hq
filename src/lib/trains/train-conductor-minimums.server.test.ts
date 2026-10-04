import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAllianceVsScoresForEvaluationPeriod: vi.fn(),
  loadAllianceRow: vi.fn(),
  minimumsRow: {
    minVsPoints: 7_200_000,
    minDonationPoints: null,
    leewayPct: 0,
    window: "daily" as const,
  },
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAllianceVsScoresForEvaluationPeriod:
    mocks.fetchAllianceVsScoresForEvaluationPeriod,
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: mocks.loadAllianceRow,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([mocks.minimumsRow]),
        }),
      }),
    }),
  }),
  schema: {
    alliances: {
      trainConductorMinVsPoints: "train_conductor_min_vs_points",
      trainConductorMinDonationPoints: "train_conductor_min_donation_points",
      trainConductorMinimumLeewayPct: "train_conductor_minimum_leeway_pct",
      trainConductorMinimumsWindow: "train_conductor_minimums_window",
      id: "id",
      updatedAt: "updated_at",
    },
  },
}));

describe("filterMemberIdsByConductorMinimums", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.loadAllianceRow.mockResolvedValue({ trainWeekStartDow: 2 });
  });

  it("filters using Ashed VS scores for the evaluation window", async () => {
    mocks.fetchAllianceVsScoresForEvaluationPeriod.mockResolvedValue(
      new Map([
        ["m-pass", 7_500_000],
        ["m-fail", 6_000_000],
      ]),
    );

    const { filterMemberIdsByConductorMinimums } = await import(
      "@/lib/trains/train-conductor-minimums.server"
    );

    const qualified = await filterMemberIdsByConductorMinimums(
      "ally-1",
      "2026-08-10",
      ["m-pass", "m-fail"],
    );

    expect(mocks.fetchAllianceVsScoresForEvaluationPeriod).toHaveBeenCalledWith(
      "ally-1",
      "2026-08-09",
      "2026-08-09",
    );
    expect(qualified).toEqual(["m-pass"]);
  });

  it("returns null when no VS scores exist for the evaluation window", async () => {
    mocks.fetchAllianceVsScoresForEvaluationPeriod.mockResolvedValue(new Map());

    const { filterMemberIdsByConductorMinimums, evaluateConductorQualification } =
      await import("@/lib/trains/train-conductor-minimums.server");

    const filtered = await filterMemberIdsByConductorMinimums(
      "ally-1",
      "2026-08-10",
      ["m-pass", "m-fail"],
    );
    expect(filtered).toBeNull();

    const qualification = await evaluateConductorQualification({
      allianceId: "ally-1",
      memberId: "m-pass",
      trainDate: "2026-08-10",
    });
    expect(qualification).toBeNull();
  });

  it("does not fetch Ashed VS when the candidate list is empty", async () => {
    const { filterMemberIdsByConductorMinimums } = await import(
      "@/lib/trains/train-conductor-minimums.server"
    );

    const qualified = await filterMemberIdsByConductorMinimums(
      "ally-1",
      "2026-08-10",
      [],
    );

    expect(qualified).toEqual([]);
    expect(mocks.fetchAllianceVsScoresForEvaluationPeriod).not.toHaveBeenCalled();
  });
});
