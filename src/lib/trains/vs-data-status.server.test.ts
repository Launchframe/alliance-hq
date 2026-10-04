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

  it("loads prior-day VS for economy week paint", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 1_000_000]]));

    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
    });

    expect(fetchPrior).toHaveBeenCalledWith("a1", "2026-06-12");
    expect(status).toEqual({
      required: false,
      ready: true,
      scoreCount: 1,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
    expect(fetchVr).not.toHaveBeenCalled();
  });

  it("loads prior-day VS for vs_high_score", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 100], ["m2", 200]]));
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      rule: { kind: "vs_top_n", topN: 1 },
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
      rule: { kind: "vs_top_n", topN: 10 },
    });
    expect(status.kind).toBe("prior_day_vs");
    expect(status.scoreDate).toBe("2026-06-12");
    expect(fetchVr).not.toHaveBeenCalled();
  });

  it("loads VR scorers for vr_top_n", async () => {
    fetchVr.mockResolvedValue([
      { memberId: "m1", memberName: "A", allianceRank: 3 },
    ]);
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      rule: { kind: "vr_top_n", topN: 3 },
    });
    expect(status).toEqual({
      required: true,
      ready: true,
      scoreCount: 1,
      kind: "vr",
    });
    expect(fetchVr).toHaveBeenCalled();
    expect(fetchPrior).not.toHaveBeenCalled();
  });

  it("loads prior-day VS for Price Is Freight", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 100], ["m2", 200]]));
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      rule: { kind: "price_is_freight", board: "weekday" },
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
      rule: { kind: "price_is_freight", board: "weekday" },
    });
    expect(status.ready).toBe(false);
    expect(status.scoreCount).toBe(0);
  });

  it("keeps Economy Week ready when prior-day VS is empty", async () => {
    fetchPrior.mockResolvedValue(new Map());
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-13",
      rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
    });
    expect(status).toEqual({
      required: false,
      ready: true,
      scoreCount: 0,
      kind: "prior_day_vs",
      scoreDate: "2026-06-12",
    });
  });

  it("loads Saturday VS for Sunday r3 lottery (Buster Day prior)", async () => {
    fetchPrior.mockResolvedValue(new Map([["m1", 500_000]]));

    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-14",
      rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
    });

    expect(fetchPrior).toHaveBeenCalledWith("a1", "2026-06-13");
    expect(status).toEqual({
      required: false,
      ready: true,
      scoreCount: 1,
      kind: "prior_day_vs",
      scoreDate: "2026-06-13",
    });
  });

  it("skips prior-day VS fetch on Monday for every conductor mechanism", async () => {
    const status = await loadTrainsVsDataStatus({
      allianceId: "a1",
      trainDate: "2026-06-15",
      rule: { kind: "vs_top_n", topN: 1 },
    });
    expect(status).toEqual({
      required: false,
      ready: true,
      scoreCount: 0,
      kind: "none",
    });
    expect(fetchPrior).not.toHaveBeenCalled();
    expect(fetchVr).not.toHaveBeenCalled();
  });
});
