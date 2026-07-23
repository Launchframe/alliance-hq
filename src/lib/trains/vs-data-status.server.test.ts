import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trains/native-scores.server", () => ({
  fetchNativeVrTopScorers: vi.fn(),
}));

vi.mock("@/lib/trains/vs-scores.server", () => ({
  fetchAlliancePriorDayVsScoresByMember: vi.fn(),
}));

import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import { loadTrainsVsDataStatus } from "@/lib/trains/vs-data-status.server";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";

const fetchVr = vi.mocked(fetchNativeVrTopScorers);
const fetchPrior = vi.mocked(fetchAlliancePriorDayVsScoresByMember);

describe("loadTrainsVsDataStatus", () => {
  beforeEach(() => {
    fetchVr.mockReset();
    fetchPrior.mockReset();
  });

  it("skips fetchers when scores are not required", async () => {
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      conductorMechanism: "r3_lottery",
      paintTemplate: "economy_week",
    });
    expect(status).toEqual({
      required: false,
      ready: true,
      scoreCount: 0,
      kind: "none",
    });
    expect(fetchVr).not.toHaveBeenCalled();
    expect(fetchPrior).not.toHaveBeenCalled();
  });

  it("loads prior-day VS for vs_high_score", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 100], ["m2", 200]]));
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      conductorMechanism: "vs_high_score",
    });
    expect(status).toEqual({
      required: true,
      ready: true,
      scoreCount: 2,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
    expect(fetchPrior).toHaveBeenCalledWith("a1", "2026-06-12");
    expect(fetchVr).not.toHaveBeenCalled();
  });

  it("loads prior-day VS for vs_top_10", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 100]]));
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      conductorMechanism: "vs_top_10",
    });
    expect(status.kind).toBe("prior_day_vs");
    expect(status.scoreDate).toBe("2026-06-12");
    expect(fetchVr).not.toHaveBeenCalled();
  });

  it("loads prior-day VS for Price Is Freight", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 100], ["m2", 200]]));
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      conductorMechanism: "r3_lottery",
      paintTemplate: "price_is_right",
    });
    expect(status).toEqual({
      required: true,
      ready: true,
      scoreCount: 2,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
    expect(fetchPrior).toHaveBeenCalledWith("a1", "2026-06-12");
    expect(fetchVr).not.toHaveBeenCalled();
  });

  it("returns not ready when prior-day VS map is empty", async () => {
    fetchPrior.mockResolvedValue(new Map());
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      conductorMechanism: "heavy_hitter_lottery",
      paintTemplate: "price_is_right",
    });
    expect(status.ready).toBe(false);
    expect(status.scoreCount).toBe(0);
  });
});
