import { describe, expect, it } from "vitest";

import {
  buildRosterDataStatus,
  classifyRosterNeed,
  rosterSyncCapabilityAllowsInPageSync,
} from "@/lib/trains/roster-data-status.shared";

describe("classifyRosterNeed", () => {
  it("detects rank pool for economy week r3 lottery", () => {
    expect(
      classifyRosterNeed({
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        date: "2026-07-25",
      }),
    ).toEqual({ kind: "rank_pool", poolType: "r3" });
  });

  it("falls back to members when mechanism is unset", () => {
    expect(classifyRosterNeed({ conductorMechanism: null })).toEqual({
      kind: "members",
      poolType: null,
    });
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
      syncCapability: "alliance_ashed",
      poolType: "r3",
    });
    expect(status.required).toBe(true);
    expect(status.ready).toBe(false);
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
