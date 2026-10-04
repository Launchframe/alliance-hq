import { describe, expect, it } from "vitest";

import { classifyPriceIsFreightEmptyReason } from "@/lib/trains/price-is-freight-roll.shared";

describe("classifyPriceIsFreightEmptyReason", () => {
  it("returns null when someone is eligible", () => {
    expect(
      classifyPriceIsFreightEmptyReason({
        rosterCandidateCount: 3,
        scoreDate: "2026-08-10",
        leadDays: 1,
        vsScoreMemberCount: 3,
        eligibleCount: 1,
      }),
    ).toBeNull();
  });

  it("reports no roster candidates before missing scores", () => {
    expect(
      classifyPriceIsFreightEmptyReason({
        rosterCandidateCount: 0,
        scoreDate: "2026-08-10",
        leadDays: 1,
        vsScoreMemberCount: 0,
        eligibleCount: 0,
      }),
    ).toEqual({ kind: "no_roster_candidates" });
  });

  it("reports missing VS when R3 exist but score map is empty", () => {
    expect(
      classifyPriceIsFreightEmptyReason({
        rosterCandidateCount: 5,
        scoreDate: "2026-08-10",
        leadDays: 1,
        vsScoreMemberCount: 0,
        eligibleCount: 0,
      }),
    ).toEqual({
      kind: "missing_vs_scores",
      scoreDate: "2026-08-10",
      leadDays: 1,
    });
  });

  it("reports none_qualify when scores exist but the band is empty", () => {
    expect(
      classifyPriceIsFreightEmptyReason({
        rosterCandidateCount: 5,
        scoreDate: "2026-08-10",
        leadDays: 0,
        vsScoreMemberCount: 4,
        eligibleCount: 0,
      }),
    ).toEqual({ kind: "none_qualify" });
  });
});
