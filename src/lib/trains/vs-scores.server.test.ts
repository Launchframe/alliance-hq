import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  base44Json: vi.fn(),
}));

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: mocks.base44Json,
}));

import {
  fetchVsScoresByRecordedDate,
  fetchVsTopScorersForTrainDate,
} from "@/lib/trains/vs-scores.server";

const CONNECTION = {
  token: "token",
  appId: "app",
  originUrl: "https://ashed.online",
};

describe("fetchVsScoresByRecordedDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the highest score when multiple rows exist for one member", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", score: 7_500_000 },
      { member_id: "m1", score: 7_200_000 },
      { member_id: "m2", score: 6_000_000 },
    ]);

    const scores = await fetchVsScoresByRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-08",
    );

    expect(scores.get("m1")).toBe(7_500_000);
    expect(scores.get("m2")).toBe(6_000_000);
  });
});

describe("fetchVsTopScorersForTrainDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns T-1 top scorers with priorDayVsScore for the wheel", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Alpha", score: 9_000_000 },
      { member_id: "m2", member_name: "Beta", score: 8_500_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
    ]);

    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-09",
      2,
    );

    expect(mocks.base44Json).toHaveBeenCalledWith(
      CONNECTION,
      expect.stringContaining(encodeURIComponent('"recorded_date":"2026-07-08"')),
    );
    expect(top).toEqual([
      { memberId: "m1", memberName: "Alpha", priorDayVsScore: 9_000_000 },
      { memberId: "m2", memberName: "Beta", priorDayVsScore: 8_500_000 },
    ]);
  });
});
