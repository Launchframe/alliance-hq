import { describe, expect, it } from "vitest";

import {
  conductorSpinSourceForTrainDay,
  resolveNominationTopBoard,
  scoreDateForTrainDay,
} from "@/lib/trains/train-day-context.shared";

describe("scoreDateForTrainDay", () => {
  it("shifts the VS reference date by lead days", () => {
    expect(scoreDateForTrainDay("2026-06-10", 0)).toBe("2026-06-09");
    expect(scoreDateForTrainDay("2026-06-10", 1)).toBe("2026-06-08");
  });
});

describe("conductorSpinSourceForTrainDay", () => {
  it("keeps the painted Top 1 even when the score day is painted Top 10", () => {
    expect(
      conductorSpinSourceForTrainDay({
        trainRule: { kind: "vs_top_n", topN: 1 },
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ kind: "vs_leaderboard", topN: 1 });
  });

  it("keeps the train day's own scope when there is no lead time", () => {
    expect(
      conductorSpinSourceForTrainDay({
        trainRule: { kind: "vs_top_n", topN: 5 },
        leadDays: 0,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ kind: "vs_leaderboard", topN: 5 });
  });

  it("keeps Price Is Freight as a non-pool raffle source", () => {
    expect(
      conductorSpinSourceForTrainDay({
        trainRule: { kind: "price_is_freight", board: "weekday" },
        leadDays: 1,
      }),
    ).toEqual({ kind: "price_is_right_raffle" });
  });

  it("has no source for free choice", () => {
    expect(conductorSpinSourceForTrainDay({ trainRule: null })).toBeNull();
  });
});

describe("resolveNominationTopBoard", () => {
  it("inherits VS scope for off-template days with lead time", () => {
    expect(
      resolveNominationTopBoard({
        trainRule: null,
        leadDays: 1,
        scoreDayRule: { kind: "vs_top_n", topN: 10 },
      }),
    ).toEqual({ kind: "vs", topN: 10 });
  });

  it("reports the VR board from the train day's own rule", () => {
    expect(
      resolveNominationTopBoard({ trainRule: { kind: "vr_top_n", topN: 5 } }),
    ).toEqual({ kind: "vr", topN: 5 });
  });

  it("has no board for pool rules", () => {
    expect(
      resolveNominationTopBoard({
        trainRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      }),
    ).toBeNull();
  });
});
