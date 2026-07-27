import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  base44Json: vi.fn(),
}));

vi.mock("@/lib/base44/fetch", () => ({
  base44Json: mocks.base44Json,
}));

import {
  fetchVsScoresByRecordedDate,
  fetchVsTopScorersForRecordedDate,
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

  it("excludes weekly week-ending totals from daily score maps", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", score: 50_000_000, is_weekly: true },
      { member_id: "m2", score: 8_000_000, is_weekly: false },
      { member_id: "m3", score: 7_500_000 },
    ]);

    const scores = await fetchVsScoresByRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-12",
    );

    expect(scores.has("m1")).toBe(false);
    expect(scores.get("m2")).toBe(8_000_000);
    expect(scores.get("m3")).toBe(7_500_000);
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
  
  it("dedupes duplicate Ashed rows for the same member before slicing Top N", async () => {
    mocks.base44Json.mockResolvedValue([
      { member_id: "m1", member_name: "Alpha", score: 9_000_000 },
      { member_id: "m1", member_name: "Alpha", score: 8_900_000 },
      { member_id: "m2", member_name: "Beta", score: 8_500_000 },
      { member_id: "m3", member_name: "Gamma", score: 8_000_000 },
    ]);

    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-09",
      2,
    );

    expect(top).toEqual([
      { memberId: "m1", memberName: "Alpha", priorDayVsScore: 9_000_000 },
      { memberId: "m2", memberName: "Beta", priorDayVsScore: 8_500_000 },
    ]);
  });
  
  it("does not use Sunday weekly totals for Monday Top VS rolls", async () => {
    mocks.base44Json.mockResolvedValue([
      {
        member_id: "m1",
        member_name: "WeekWinner",
        score: 80_000_000,
        is_weekly: true,
      },
      {
        member_id: "m2",
        member_name: "AlsoWeekly",
        score: 70_000_000,
        isWeekly: true,
      },
    ]);

    // 2026-07-13 is Monday → T−1 Sunday week-ending date.
    const top = await fetchVsTopScorersForTrainDate(
      CONNECTION,
      "alliance-1",
      "2026-07-13",
      10,
    );

    expect(top).toEqual([]);
    expect(mocks.base44Json).not.toHaveBeenCalled();
  });

  it("ignores weekly rows if Ashed is queried for a Sunday recorded_date", async () => {
    mocks.base44Json.mockResolvedValue([
      {
        member_id: "m1",
        member_name: "WeekWinner",
        score: 80_000_000,
        is_weekly: true,
      },
      {
        member_id: "m2",
        member_name: "DailyOnly",
        score: 9_000_000,
        is_weekly: false,
      },
    ]);

    const top = await fetchVsTopScorersForRecordedDate(
      CONNECTION,
      "alliance-1",
      "2026-07-12",
      10,
    );

    expect(top).toEqual([
      { memberId: "m2", memberName: "DailyOnly", priorDayVsScore: 9_000_000 },
    ]);
  });
});
