import { describe, expect, it } from "vitest";

import { DEFAULT_ALLIANCE_TRAIN_WEEK } from "@/lib/trains/train-week-calendar.shared";
import {
  isMemberEligibleForPaintRule,
  planPaintRuleConductorGates,
  shouldKeepAssignedConductorOnPaint,
} from "@/lib/trains/paint-rule-conductor-gate.shared";

describe("isMemberEligibleForPaintRule", () => {
  it("keeps an R3 member for Economy Week / R3 lottery", () => {
    expect(
      isMemberEligibleForPaintRule({
        memberId: "m1",
        onRoster: true,
        allianceRank: 3,
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        date: "2026-08-12",
      }),
    ).toBe(true);
  });

  it("rejects an R4 member for Economy Week", () => {
    expect(
      isMemberEligibleForPaintRule({
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        conductorMechanism: "r3_lottery",
        paintTemplate: "economy_week",
        date: "2026-08-12",
      }),
    ).toBe(false);
  });

  it("keeps an R4 member for the R4 officer sequence", () => {
    expect(
      isMemberEligibleForPaintRule({
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        conductorMechanism: "r4_sequence",
        paintTemplate: "r4_train_week",
        date: "2026-08-12",
      }),
    ).toBe(true);
  });

  it("does not affirm Top VS eligibility without a live board", () => {
    expect(
      isMemberEligibleForPaintRule({
        memberId: "m1",
        onRoster: true,
        allianceRank: 3,
        conductorMechanism: "vs_top_n",
        paintTemplate: "top_vs",
        date: "2026-08-12",
        conductorConfig: { topN: 10 },
      }),
    ).toBe(false);
  });
});

describe("shouldKeepAssignedConductorOnPaint", () => {
  it("keeps the assignment when the draw did not change", () => {
    expect(
      shouldKeepAssignedConductorOnPaint({
        drawChanged: false,
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        nextMechanism: "r3_lottery",
        nextPaintTemplate: "economy_week",
        date: "2026-08-12",
      }),
    ).toBe(true);
  });

  it("clears when the draw changed and the member is not eligible", () => {
    expect(
      shouldKeepAssignedConductorOnPaint({
        drawChanged: true,
        memberId: "m1",
        onRoster: true,
        allianceRank: 4,
        nextMechanism: "r3_lottery",
        nextPaintTemplate: "economy_week",
        date: "2026-08-12",
      }),
    ).toBe(false);
  });
});

describe("planPaintRuleConductorGates", () => {
  const trainWeekConfig = DEFAULT_ALLIANCE_TRAIN_WEEK;
  const dayConfigs = [
    {
      id: "d1",
      date: "2026-08-12",
      conductorMechanism: "r4_sequence",
      vipMechanism: "conductor_pick",
      vipConfig: null,
      isOverride: true,
      paintTemplate: "r4_train_week" as const,
    },
  ];

  it("keeps a locked R3 conductor when painting another R3 rule", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      templateType: "economy_week",
      trainWeekConfig,
      weekTemplateApply: false,
      dayConfigs: [
        {
          ...dayConfigs[0]!,
          conductorMechanism: "r3_lottery",
          paintTemplate: "r3_recognition",
        },
      ],
      records: [
        {
          id: "r1",
          date: "2026-08-12",
          conductorMemberId: "m1",
          conductorMemberName: "Alice",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r3_lottery",
          vipMechanism: "conductor_pick",
          guardianIsVip: false,
          lockedAt: "2026-08-12T12:00:00.000Z",
          substituteForMemberId: null,
          substituteForMemberName: null,
        },
      ],
      roster: [{ memberId: "m1", allianceRank: 3 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([]);
  });

  it("asks to clear a pending R4 conductor painted onto Economy Week", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      templateType: "economy_week",
      trainWeekConfig,
      weekTemplateApply: false,
      dayConfigs,
      records: [
        {
          id: "r1",
          date: "2026-08-12",
          conductorMemberId: "m1",
          conductorMemberName: "Alice",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r4_sequence",
          vipMechanism: "conductor_pick",
          guardianIsVip: false,
          lockedAt: null,
          substituteForMemberId: null,
          substituteForMemberName: null,
        },
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers).toEqual([
      expect.objectContaining({
        date: "2026-08-12",
        conductorName: "Alice",
        locked: false,
        kind: "clear",
      }),
    ]);
  });

  it("requests unlock when a locked ineligible conductor cannot be unlocked", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      templateType: "economy_week",
      trainWeekConfig,
      weekTemplateApply: false,
      dayConfigs,
      records: [
        {
          id: "r1",
          date: "2026-08-12",
          conductorMemberId: "m1",
          conductorMemberName: "Alice",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r4_sequence",
          vipMechanism: "conductor_pick",
          guardianIsVip: false,
          lockedAt: "2026-08-12T12:00:00.000Z",
          substituteForMemberId: null,
          substituteForMemberName: null,
        },
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers[0]?.kind).toBe("request_unlock");
  });

  it("offers clear when the officer can unlock a locked ineligible conductor", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      templateType: "economy_week",
      trainWeekConfig,
      weekTemplateApply: false,
      dayConfigs,
      records: [
        {
          id: "r1",
          date: "2026-08-12",
          conductorMemberId: "m1",
          conductorMemberName: "Alice",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r4_sequence",
          vipMechanism: "conductor_pick",
          guardianIsVip: false,
          lockedAt: "2026-08-12T12:00:00.000Z",
          substituteForMemberId: null,
          substituteForMemberName: null,
        },
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: true,
    });
    expect(plan.blockers[0]?.kind).toBe("clear");
    expect(plan.blockers[0]?.locked).toBe(true);
  });

  it("offers clear when train ownership can unlock a locked ineligible conductor", () => {
    const plan = planPaintRuleConductorGates({
      dates: ["2026-08-12"],
      templateType: "economy_week",
      trainWeekConfig,
      weekTemplateApply: false,
      dayConfigs,
      records: [
        {
          id: "r1",
          date: "2026-08-12",
          conductorMemberId: "m1",
          conductorMemberName: "Alice",
          vipMemberId: null,
          vipMemberName: null,
          conductorMechanism: "r4_sequence",
          vipMechanism: "conductor_pick",
          guardianIsVip: false,
          lockedAt: "2026-08-12T12:00:00.000Z",
          canUnlock: true,
          substituteForMemberId: null,
          substituteForMemberName: null,
        },
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
      canUnlockConductor: false,
    });
    expect(plan.blockers[0]?.kind).toBe("clear");
  });
});
