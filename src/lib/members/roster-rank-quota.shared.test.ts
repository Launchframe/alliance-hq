import { describe, expect, it } from "vitest";

import {
  computeProjectedRosterRankCounts,
  isNearFullRoster,
  rosterNearFullThreshold,
  validateRosterRankQuota,
} from "@/lib/members/roster-rank-quota.shared";

describe("roster-rank-quota.shared", () => {
  it("merges commit rows into existing roster for projection", () => {
    const counts = computeProjectedRosterRankCounts(
      [
        { ashedMemberId: "a", allianceRank: 5, status: "active" },
        { ashedMemberId: "b", allianceRank: 3, status: "active" },
      ],
      [{ matchMemberId: "b", allianceRank: 4 }],
    );

    expect(counts).toMatchObject({ r5: 1, r4: 1, r3: 0, total: 2 });
  });

  it("counts new members from unmatched commit rows", () => {
    const counts = computeProjectedRosterRankCounts(
      [{ ashedMemberId: "a", allianceRank: 5, status: "active" }],
      [
        { matchMemberId: null, allianceRank: 3 },
        { matchMemberId: null, allianceRank: 1 },
      ],
    );

    expect(counts).toMatchObject({ r5: 1, r3: 1, r1: 1, total: 3 });
  });

  it("requires exactly one R5", () => {
    expect(
      validateRosterRankQuota({
        r1: 0,
        r2: 0,
        r3: 0,
        r4: 0,
        r5: 0,
        total: 1,
      }),
    ).toContain("r5_required");

    expect(
      validateRosterRankQuota({
        r1: 0,
        r2: 0,
        r3: 0,
        r4: 0,
        r5: 2,
        total: 2,
      }),
    ).toContain("r5_multiple");
  });

  it("enforces R4 cap and R123 limit when R4 is full", () => {
    expect(
      validateRosterRankQuota({
        r1: 0,
        r2: 0,
        r3: 0,
        r4: 11,
        r5: 1,
        total: 12,
      }),
    ).toContain("r4_max");

    expect(
      validateRosterRankQuota({
        r1: 100,
        r2: 50,
        r3: 40,
        r4: 10,
        r5: 1,
        total: 201,
      }),
    ).toEqual(expect.arrayContaining(["r123_when_r4_full", "total_max"]));
  });

  it("treats roster within 3% of cap as near-full for invite UX", () => {
    expect(rosterNearFullThreshold()).toBe(194);
    expect(isNearFullRoster(193)).toBe(false);
    expect(isNearFullRoster(194)).toBe(true);
    expect(isNearFullRoster(199)).toBe(true);
    expect(isNearFullRoster(200)).toBe(true);
  });

  it("requires solo member to be R5", () => {
    expect(
      validateRosterRankQuota({
        r1: 1,
        r2: 0,
        r3: 0,
        r4: 0,
        r5: 0,
        total: 1,
      }),
    ).toContain("solo_must_be_r5");
  });
});
