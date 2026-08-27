import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDisplayMergedDayConfigForDate: vi.fn(),
  fetchAlliancePriorDayVsScoresByMember: vi.fn(),
  fetchAllianceVsTopScorersForTrainDate: vi.fn(),
}));

vi.mock("@/lib/trains/day-config-resolve.server", () => ({
  resolveDisplayMergedDayConfigForDate:
    mocks.resolveDisplayMergedDayConfigForDate,
  resolveRollDayConfig: mocks.resolveDisplayMergedDayConfigForDate,
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAlliancePriorDayVsScoresByMember:
    mocks.fetchAlliancePriorDayVsScoresByMember,
  fetchAllianceVsTopScorersForTrainDate:
    mocks.fetchAllianceVsTopScorersForTrainDate,
}));

vi.mock("@/lib/trains/vr-reporter-count.server", () => ({
  countAllianceVrReporters: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/trains/native-scores.server", () => ({
  fetchNativeVrTopScorers: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/trains/pool", () => ({
  getPoolSummary: vi.fn(),
}));

vi.mock("@/lib/trains/price-is-freight-roll.server", () => ({
  loadPriceIsFreightR3Candidates: vi.fn(),
}));

vi.mock("@/lib/trains/train-economy-threshold.server", () => ({
  buildPriceIsRightWeightedCandidates: vi.fn(),
  loadPriceIsRightTicketSettings: vi.fn(),
  loadTrainEconomyThreshold: vi.fn(),
}));

vi.mock("@/lib/trains/heavy-hitter-pool.server", () => ({
  buildHeavyHitterPoolCandidates: vi.fn(),
}));

import { loadTrainDayScoreStats } from "@/lib/trains/day-score-stats.server";

describe("loadTrainDayScoreStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAlliancePriorDayVsScoresByMember.mockResolvedValue(new Map());
    mocks.fetchAllianceVsTopScorersForTrainDate.mockResolvedValue([]);
  });

  it("resolves score reference day from DB when outside the loaded week batch", async () => {
    mocks.resolveDisplayMergedDayConfigForDate.mockResolvedValue({
      conductorMechanism: "vs_top_10",
      conductorConfig: { topN: 10 },
      paintTemplate: "vs_push_weekdays",
    });

    const stats = await loadTrainDayScoreStats({
      allianceId: "ally-1",
      trainDate: "2026-08-31",
      conductorMechanism: "r4_sequence",
      paintTemplate: "r4_event_vip",
      leadDays: 1,
      seasonKey: "S1",
      scoreDateDay: null,
    });

    expect(mocks.resolveDisplayMergedDayConfigForDate).toHaveBeenCalledWith(
      "ally-1",
      "2026-08-29",
      "S1",
    );
    expect(stats).toMatchObject({
      kind: "prior_day_vs",
      required: false,
      scoreDate: "2026-08-29",
    });
  });
});
