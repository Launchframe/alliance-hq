import { describe, expect, it } from "vitest";

import { mapPersistedMyVsDays } from "./my-performance.shared";

describe("mapPersistedMyVsDays", () => {
  it("maps met, missed zero, excused, unknown, and open assessments", () => {
    const days = mapPersistedMyVsDays([
      { date: "2026-03-02", assessment: "met", score: 1_500_000 },
      { date: "2026-03-03", assessment: "missed", score: 0 },
      { date: "2026-03-04", assessment: "excused", score: null },
      { date: "2026-03-05", assessment: "unknown", score: 900_000 },
      { date: "2026-03-06", assessment: "open", score: 10 },
      { date: "2026-03-07", assessment: "missed", score: 250_000 },
    ]);
    expect(days).toEqual([
      { date: "2026-03-02", score: "1500000", state: "met", source: null },
      { date: "2026-03-03", score: "0", state: "missed", source: null },
      { date: "2026-03-04", score: null, state: "excused", source: null },
      { date: "2026-03-05", score: null, state: "unverified", source: null },
      { date: "2026-03-06", score: null, state: "open", source: null },
      { date: "2026-03-07", score: "250000", state: "missed", source: null },
    ]);
  });
});
