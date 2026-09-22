import { describe, expect, it } from "vitest";

import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";
import {
  planPaintRuleConductorGates,
  shouldKeepAssignedConductorOnPaint,
} from "@/lib/trains/paint-rule-conductor-gate.shared";
import type { WeekConductorRecordSummary } from "@/lib/trains/conductor-record.shared";

const R3_WHEEL: ConductorRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };
const R4: ConductorRule = { kind: "rank_pool", pool: "r4_plus", draw: "wheel" };
const PIF_HH: ConductorRule = {
  kind: "price_is_freight",
  board: "heavy_hitter",
};

function record(
  overrides: Partial<WeekConductorRecordSummary> = {},
): WeekConductorRecordSummary {
  return {
    id: "r1",
    date: "2026-08-12",
    conductorMemberId: "m1",
    conductorMemberName: "Alice",
    vipMemberId: null,
    vipMemberName: null,
    conductorRule: null,
    vipRule: null,
    conductorMechanism: null,
    vipMechanism: null,
    guardianIsVip: false,
    lockedAt: null,
    substituteForMemberId: null,
    substituteForMemberName: null,
    ...overrides,
  };
}

describe("shouldKeepAssignedConductorOnPaint", () => {
  it("keeps the assignment when the rule did not change", () => {
    expect(
      shouldKeepAssignedConductorOnPaint({
        ruleChanged: false,
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        nextRule: R3_WHEEL,
      }),
    ).toBe(true);
  });

  it("clears when the rule changed and the member is provably ineligible", () => {
    expect(
      shouldKeepAssignedConductorOnPaint({
        ruleChanged: true,
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        nextRule: R3_WHEEL,
      }),
    ).toBe(false);
  });

  it("keeps the assignment when the new rule's board cannot be proven", () => {
    expect(
      shouldKeepAssignedConductorOnPaint({
        ruleChanged: true,
        memberId: "m1",
        onRoster: true,
        allianceRank: 1,
        nextRule: { kind: "vs_top_n", topN: 1 },
      }),
    ).toBe(true);
  });
});

describe("planPaintRuleConductorGates", () => {
  it("keeps a locked R3 conductor when painting another R3 rule", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      nextRule: R3_WHEEL,
      dayConfigs: [
        {
          date: "2026-08-12",
          conductorRule: { kind: "rank_pool", pool: "r3", draw: "manual" },
        },
      ],
      records: [
        record({
          conductorRule: { kind: "rank_pool", pool: "r3", draw: "manual" },
          lockedAt: "2026-08-12T12:00:00.000Z",
        }),
      ],
      roster: [{ memberId: "m1", allianceRank: 3 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([]);
  });

  it("asks to clear a pending R4 conductor painted onto the R3 wheel", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      nextRule: R3_WHEEL,
      dayConfigs: [{ date: "2026-08-12", conductorRule: R4 }],
      records: [record({ conductorRule: R4 })],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        date: "2026-08-12",
        conductorName: "Alice",
        kind: "clear",
        locked: false,
      }),
    ]);
  });

  it("asks to request an unlock when the officer cannot unlock the day", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      nextRule: R3_WHEEL,
      dayConfigs: [{ date: "2026-08-12", conductorRule: R4 }],
      records: [
        record({ conductorRule: R4, lockedAt: "2026-08-12T12:00:00.000Z" }),
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers[0]).toEqual(
      expect.objectContaining({ kind: "request_unlock", locked: true }),
    );
  });

  it("does not gate a Saturday max-ticket paint over an on-roster conductor", () => {
    // Regression: the max-ticket board is not knowable client-side, and
    // treating that as ineligible pulled a valid conductor off the day.
    const plan = planPaintRuleConductorGates({
      dates: ["2026-09-19"],
      nextRule: PIF_HH,
      dayConfigs: [{ date: "2026-09-19", conductorRule: R4 }],
      records: [record({ date: "2026-09-19", conductorRule: R4 })],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([]);
  });

  it("ignores dates outside the paint", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-13"],
      nextRule: R3_WHEEL,
      dayConfigs: [{ date: "2026-08-12", conductorRule: R4 }],
      records: [record({ conductorRule: R4 })],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([]);
  });
});
