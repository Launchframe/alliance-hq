import { describe, expect, it } from "vitest";

import {
  buildRosterDataStatus,
  classifyRosterNeed,
  rosterSyncCapabilityAllowsInPageSync,
} from "@/lib/trains/roster-data-status.shared";

describe("classifyRosterNeed", () => {
  it("detects the rank pool behind the R3 wheel", () => {
    expect(
      classifyRosterNeed({
        rule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      }),
    ).toEqual({ kind: "rank_pool", poolType: "r3" });
  });

  it("falls back to members for free choice", () => {
    expect(classifyRosterNeed({ rule: null })).toEqual({
      kind: "members",
      poolType: null,
    });
  });

  it("falls back to members for score boards", () => {
    expect(
      classifyRosterNeed({ rule: { kind: "vs_top_n", topN: 10 } }),
    ).toEqual({ kind: "members", poolType: null });
  });
});

describe("buildRosterDataStatus", () => {
  it("requires roster when active member count is zero", () => {
    const status = buildRosterDataStatus({
      needKind: "members",
      activeMemberCount: 0,
      eligiblePoolCount: 0,
      syncCapability: "officer_ashed",
      poolType: null,
    });
    expect(status.required).toBe(true);
    expect(status.ready).toBe(false);
  });

  it("requires roster when rank pool has no eligible members", () => {
    const status = buildRosterDataStatus({
      needKind: "rank_pool",
      activeMemberCount: 12,
      eligiblePoolCount: 0,
      rankEligiblePoolCount: 0,
      syncCapability: "alliance_ashed",
      poolType: "r3",
    });
    expect(status.required).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.blockerKind).toBe("missing_rank_pool");
  });

  it("detects conductor minimums as the blocker", () => {
    const status = buildRosterDataStatus({
      needKind: "rank_pool",
      activeMemberCount: 12,
      eligiblePoolCount: 0,
      rankEligiblePoolCount: 5,
      syncCapability: "alliance_ashed",
      poolType: "r3",
    });
    expect(status.blockerKind).toBe("conductor_minimums");
    expect(status.required).toBe(false);
    expect(status.ready).toBe(true);
  });

  it("is ready when members exist and rank pool has candidates", () => {
    const status = buildRosterDataStatus({
      needKind: "rank_pool",
      activeMemberCount: 12,
      eligiblePoolCount: 4,
      syncCapability: "native_reload",
      poolType: "r3",
    });
    expect(status.required).toBe(false);
    expect(status.ready).toBe(true);
  });
});

describe("rosterSyncCapabilityAllowsInPageSync", () => {
  it("allows known sync paths", () => {
    expect(rosterSyncCapabilityAllowsInPageSync("officer_ashed")).toBe(true);
    expect(rosterSyncCapabilityAllowsInPageSync("alliance_ashed")).toBe(true);
    expect(rosterSyncCapabilityAllowsInPageSync("native_reload")).toBe(true);
    expect(rosterSyncCapabilityAllowsInPageSync("none")).toBe(false);
  });
});
