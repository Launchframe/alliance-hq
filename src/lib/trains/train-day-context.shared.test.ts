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
  it("inherits VS top-N from the score reference day under lead time", () => {
    expect(
      conductorSpinSourceForTrainDay({
        trainDate: "2026-08-28",
        trainDay: { conductorMechanism: "vs_high_score" },
        leadDays: 1,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toEqual({ kind: "vs_leaderboard", topN: 10 });
  });

  it("keeps Price Is Freight as a non-pool raffle source", () => {
    expect(
      conductorSpinSourceForTrainDay({
        trainDate: "2026-06-09",
        trainDay: {
          conductorMechanism: "r3_lottery",
          paintTemplate: "price_is_right",
        },
        leadDays: 1,
      }),
    ).toEqual({ kind: "price_is_right_raffle" });
  });
});

describe("resolveNominationTopBoard", () => {
  it("inherits VS scope for off-template days with lead time", () => {
    expect(
      resolveNominationTopBoard({
        trainDate: "2026-08-30",
        trainDay: { conductorMechanism: "custom" },
        leadDays: 1,
        scoreDateDay: { conductorMechanism: "vs_top_10" },
      }),
    ).toEqual({
      kind: "vs",
      topN: 10,
      mechanism: "vs_top_10",
    });
  });
});
