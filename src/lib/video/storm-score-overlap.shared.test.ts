import { describe, expect, it } from "vitest";

import {
  ashedStormScoresOverlapTeam,
  isStormTeam,
} from "@/lib/video/storm-score-overlap.shared";

describe("isStormTeam", () => {
  it("accepts A and B only", () => {
    expect(isStormTeam("A")).toBe(true);
    expect(isStormTeam("B")).toBe(true);
    expect(isStormTeam("C")).toBe(false);
    expect(isStormTeam(null)).toBe(false);
  });
});

describe("ashedStormScoresOverlapTeam", () => {
  it("matches the same team and recorded date", () => {
    expect(
      ashedStormScoresOverlapTeam({
        rows: [
          { team: "A", recorded_date: "2026-07-10" },
          { team: "B", recorded_date: "2026-07-10" },
        ],
        team: "B",
        recordedDate: "2026-07-10",
      }),
    ).toBe(true);
  });

  it("ignores the other team", () => {
    expect(
      ashedStormScoresOverlapTeam({
        rows: [{ team: "A", recorded_date: "2026-07-10" }],
        team: "B",
        recordedDate: "2026-07-10",
      }),
    ).toBe(false);
  });

  it("treats missing recorded_date on Ashed rows as an overlap for the team", () => {
    expect(
      ashedStormScoresOverlapTeam({
        rows: [{ team: "A", recorded_date: null }],
        team: "A",
        recordedDate: "2026-07-10",
      }),
    ).toBe(true);
  });
});
