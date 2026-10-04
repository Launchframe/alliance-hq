import { describe, expect, it } from "vitest";

import { PRESET_WEEK_RULES } from "@/lib/trains/rules/presets.shared";

import type { DayRules } from "@/lib/trains/rules/catalog.shared";
import {
  applyOptimisticClearPendingConductor,
  applyOptimisticConductorPick,
  applyOptimisticConductorSwap,
  applyOptimisticLock,
  applyOptimisticPaint,
  applyOptimisticWeekTemplate,
  patchDayConfigsForDates,
  upsertRecordForDate,
} from "@/lib/trains/optimistic-dashboard.shared";

const R3_WHEEL: DayRules = {
  conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
  vipRule: null,
};
const R4: DayRules = {
  conductorRule: { kind: "rank_pool", pool: "r4_plus", draw: "wheel" },
  vipRule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
};
const VS_TOP_10: DayRules = {
  conductorRule: { kind: "vs_top_n", topN: 10 },
  vipRule: null,
};
const FREE: DayRules = { conductorRule: null, vipRule: { kind: "none" } };

function dayConfig(date: string, rules: DayRules, id = `d-${date}`) {
  return {
    id,
    date,
    conductorRule: rules.conductorRule,
    vipRule: rules.vipRule,
    isOverride: false,
    sourceTemplateId: null,
  };
}

function conductorRecord(
  date: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `r-${date}`,
    date,
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

function snapshot(input: {
  dayConfigs: ReturnType<typeof dayConfig>[];
  weekRecords?: ReturnType<typeof conductorRecord>[];
  roster?: Array<{ memberId: string; allianceRank?: number | null }>;
}) {
  const dayConfigs = input.dayConfigs;
  const weekRecords = input.weekRecords ?? [];
  return {
    data: {
      today: "2026-06-10",
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      trainWeekStartDow: 1,
      roster: input.roster ?? [],
      weekRecords,
      dayConfigs,
      conductorRecord: null,
      schedule: {
        id: "s1",
        weekStart: "2026-06-08",
        templateId: "tmpl-existing",
        isPivot: false,
      },
      schedulePersisted: true,
    },
    viewedWeek: {
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      templateId: null,
      dayConfigs,
      weekRecords,
      dayScoreStats: {},
    },
    viewedMonth: {
      monthKey: "2026-06",
      monthStart: "2026-06-01",
      monthEnd: "2026-06-30",
      dayConfigs,
      monthRecords: weekRecords,
    },
  } as unknown as Parameters<typeof applyOptimisticPaint>[0];
}

describe("optimistic dashboard state", () => {
  it("does not mark an eligibility override until the server snapshot says so", () => {
    const snap = snapshot({ dayConfigs: [] });
    const next = applyOptimisticConductorPick(snap, "2026-06-10", {
      memberId: "m1",
      memberName: "Alice",
    });
    expect(next.data.weekRecords[0]?.eligibilityOverridden).toBe(false);
  });

  it("upserts a draft conductor on an empty day", () => {
    const next = upsertRecordForDate([], "2026-06-10", {
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.conductorMemberName).toBe("Alice");
  });

  it("paints the same rule onto every selected date", () => {
    const painted = patchDayConfigsForDates(
      [dayConfig("2026-06-10", VS_TOP_10), dayConfig("2026-06-11", VS_TOP_10)],
      ["2026-06-10", "2026-06-11"],
      R3_WHEEL,
      "economy_week",
    );
    for (const day of painted) {
      expect(day.conductorRule).toEqual(R3_WHEEL.conductorRule);
      expect(day.isOverride).toBe(true);
      expect(day.sourceTemplateId).toBe("economy_week");
    }
  });

  it("keeps the scope when re-painting the same board at a different scope", () => {
    const painted = patchDayConfigsForDates(
      [dayConfig("2026-06-10", VS_TOP_10)],
      ["2026-06-10"],
      { conductorRule: { kind: "vs_top_n", topN: 5 }, vipRule: null },
    );
    expect(painted[0]?.conductorRule).toEqual({ kind: "vs_top_n", topN: 5 });
  });

  it("clears a pending conductor when the rule changes and they are ineligible", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R4)],
      weekRecords: [conductorRecord("2026-06-10", { conductorRule: R4.conductorRule })],
      roster: [{ memberId: "m1", allianceRank: 4 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], R3_WHEEL);
    expect(next.data.weekRecords[0]?.conductorMemberId).toBeNull();
  });

  it("keeps a pending R3 conductor when painting another R3 rule", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R3_WHEEL)],
      weekRecords: [
        conductorRecord("2026-06-10", { conductorRule: R3_WHEEL.conductorRule }),
      ],
      roster: [{ memberId: "m1", allianceRank: 3 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], {
      conductorRule: { kind: "rank_pool", pool: "r3", draw: "manual" },
      vipRule: null,
    });
    expect(next.data.weekRecords[0]?.conductorMemberId).toBe("m1");
  });

  it("keeps a locked conductor the new rule cannot disprove", () => {
    // Regression: a Saturday max-ticket paint used to pull a valid on-roster
    // conductor off the day because the board is not knowable client-side.
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-13", R4)],
      weekRecords: [
        conductorRecord("2026-06-13", {
          conductorRule: R4.conductorRule,
          lockedAt: "2026-06-13T12:00:00.000Z",
        }),
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-13"], {
      conductorRule: { kind: "price_is_freight", board: "heavy_hitter" },
      vipRule: null,
    });
    expect(next.data.weekRecords[0]?.conductorMemberId).toBe("m1");
  });

  it("clears VIP picks when the conductor rule changes", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R4)],
      weekRecords: [
        conductorRecord("2026-06-10", {
          conductorRule: R4.conductorRule,
          conductorMemberId: null,
          conductorMemberName: null,
          vipMemberId: "m2",
          vipMemberName: "Bob",
        }),
      ],
      roster: [],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], R3_WHEEL);
    expect(next.data.weekRecords[0]?.vipMemberId).toBeNull();
  });

  it("paints across data, week, and month snapshots", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", VS_TOP_10), dayConfig("2026-06-11", VS_TOP_10)],
    });

    const next = applyOptimisticPaint(
      snap,
      ["2026-06-10", "2026-06-11"],
      FREE,
    );
    for (const page of [next.data, next.viewedWeek, next.viewedMonth]) {
      for (const day of page.dayConfigs) {
        expect(day.conductorRule).toBeNull();
      }
    }
  });

  it("stamps the week template only when the paint sets one", () => {
    const snap = snapshot({ dayConfigs: [dayConfig("2026-06-10", VS_TOP_10)] });

    expect(
      applyOptimisticPaint(snap, ["2026-06-10"], R3_WHEEL).data.schedule
        ?.templateId,
    ).toBe("tmpl-existing");
    expect(
      applyOptimisticPaint(snap, ["2026-06-10"], R3_WHEEL, {
        updateWeekTemplate: "tmpl-economy",
      }).data.schedule?.templateId,
    ).toBe("tmpl-economy");
  });

  it("applies a template's calendar-weekday rules", () => {
    const snap = snapshot({ dayConfigs: [] });
    const next = applyOptimisticWeekTemplate(snap, "2026-06-08", {
      id: "tmpl-pif",
      days: PRESET_WEEK_RULES.price_is_right,
    });
    const saturday = next.viewedWeek.dayConfigs.find(
      (day) => day.date === "2026-06-13",
    );
    expect(saturday?.conductorRule).toEqual({
      kind: "price_is_freight",
      board: "heavy_hitter",
    });
    expect(next.viewedWeek.templateId).toBe("tmpl-pif");
  });

  it("locks a day across schedule views", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R3_WHEEL)],
      weekRecords: [conductorRecord("2026-06-10")],
    });
    const next = applyOptimisticLock(snap, "2026-06-10", "2026-06-10T12:00:00.000Z");
    expect(next.viewedWeek.weekRecords[0]?.lockedAt).toBe(
      "2026-06-10T12:00:00.000Z",
    );
    expect(next.viewedMonth.monthRecords[0]?.lockedAt).toBe(
      "2026-06-10T12:00:00.000Z",
    );
  });

  it("clears a pending conductor across schedule views", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R3_WHEEL)],
      weekRecords: [conductorRecord("2026-06-10")],
    });
    const next = applyOptimisticClearPendingConductor(snap, "2026-06-10");
    expect(next.viewedWeek.weekRecords[0]?.conductorMemberId).toBeNull();
    expect(next.viewedMonth.monthRecords[0]?.conductorMemberId).toBeNull();
  });
});

describe("conductor swap", () => {

  it("swaps conductors and substitute metadata between two days", () => {
    const recordA = {
      id: "a",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      vipMemberId: null,
      vipMemberName: null,
      conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      vipRule: null,
      conductorMechanism: "r3_lottery",
      vipMechanism: null,
      guardianIsVip: false,
      lockedAt: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
    };
    const recordB = {
      id: "b",
      date: "2026-06-11",
      conductorMemberId: "m2",
      conductorMemberName: "Bob",
      vipMemberId: null,
      vipMemberName: null,
      conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      vipRule: null,
      conductorMechanism: "r3_lottery",
      vipMechanism: null,
      guardianIsVip: false,
      lockedAt: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
    };
    const base = {
      data: {
        today: "2026-06-10",
        weekRecords: [recordA, recordB],
        dayConfigs: [],
        conductorRecord: recordA,
      },
      viewedWeek: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        templateType: null,
        dayConfigs: [],
        weekRecords: [recordA, recordB],
      },
      viewedMonth: {
        monthKey: "2026-06",
        monthStart: "2026-06-01",
        monthEnd: "2026-06-30",
        dayConfigs: [],
        monthRecords: [recordA, recordB],
      },
    } as unknown as Parameters<typeof applyOptimisticConductorSwap>[0];

    const swapped = applyOptimisticConductorSwap(
      base,
      "2026-06-10",
      "2026-06-11",
      "2026-06-12T12:00:00.000Z",
    );
    const dayA = swapped.viewedWeek.weekRecords.find((r) => r.date === "2026-06-10");
    const dayB = swapped.viewedWeek.weekRecords.find((r) => r.date === "2026-06-11");
    expect(dayA?.conductorMemberName).toBe("Bob");
    expect(dayA?.substituteForMemberName).toBe("Alice");
    expect(dayB?.conductorMemberName).toBe("Alice");
    expect(dayB?.substituteForMemberName).toBe("Bob");
    expect(dayA?.lockedAt).toBe("2026-06-12T12:00:00.000Z");
    expect(dayB?.lockedAt).toBe("2026-06-12T12:00:00.000Z");
  });

  it("moves a conductor onto an open day and clears the source day", () => {
    const recordA = {
      id: "a",
      date: "2026-06-10",
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
      vipMemberId: "m9",
      vipMemberName: "VIP Nine",
      conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
      vipRule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
      conductorMechanism: "r3_lottery",
      vipMechanism: "event_top_x_lottery",
      guardianIsVip: true,
      lockedAt: null,
      substituteForMemberId: null,
      substituteForMemberName: null,
    };
    const base = {
      data: {
        today: "2026-06-10",
        weekRecords: [recordA],
        dayConfigs: [],
        conductorRecord: recordA,
      },
      viewedWeek: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        templateType: null,
        dayConfigs: [],
        weekRecords: [recordA],
      },
      viewedMonth: {
        monthKey: "2026-06",
        monthStart: "2026-06-01",
        monthEnd: "2026-06-30",
        dayConfigs: [],
        monthRecords: [recordA],
      },
    } as unknown as Parameters<typeof applyOptimisticConductorSwap>[0];

    const swapped = applyOptimisticConductorSwap(
      base,
      "2026-06-10",
      "2026-06-12",
      "2026-06-12T12:00:00.000Z",
    );
    const dayA = swapped.viewedWeek.weekRecords.find((r) => r.date === "2026-06-10");
    const dayB = swapped.viewedWeek.weekRecords.find((r) => r.date === "2026-06-12");
    expect(dayA?.conductorMemberId).toBeNull();
    expect(dayA?.vipMemberId).toBeNull();
    expect(dayA?.vipMemberName).toBeNull();
    expect(dayA?.guardianIsVip).toBe(false);
    expect(dayA?.lockedAt).toBeNull();
    expect(dayB?.conductorMemberName).toBe("Alice");
    expect(dayB?.lockedAt).toBe("2026-06-12T12:00:00.000Z");
  });
});

describe("partial day paint", () => {
  it("preserves an event VIP on a conductor-only paint", () => {
    const painted = patchDayConfigsForDates(
      [dayConfig("2026-06-10", R4)],
      ["2026-06-10"],
      { conductorRule: { kind: "vs_top_n", topN: 5 } },
    );
    expect(painted[0]?.conductorRule).toEqual({ kind: "vs_top_n", topN: 5 });
    expect(painted[0]?.vipRule).toEqual(R4.vipRule);
  });

  it("preserves the conductor rule on a VIP-only paint", () => {
    const painted = patchDayConfigsForDates(
      [dayConfig("2026-06-10", VS_TOP_10)],
      ["2026-06-10"],
      { vipRule: { kind: "donations_second" } },
    );
    expect(painted[0]?.conductorRule).toEqual(VS_TOP_10.conductorRule);
    expect(painted[0]?.vipRule).toEqual({ kind: "donations_second" });
  });

  it("clears only the side painted null", () => {
    const painted = patchDayConfigsForDates(
      [dayConfig("2026-06-10", R4)],
      ["2026-06-10"],
      { vipRule: null },
    );
    expect(painted[0]?.conductorRule).toEqual(R4.conductorRule);
    expect(painted[0]?.vipRule).toBeNull();
  });

  it("keeps the assigned conductor and restamps rules on a VIP-only paint", () => {
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", R4)],
      weekRecords: [
        conductorRecord("2026-06-10", { conductorRule: R4.conductorRule }),
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], {
      vipRule: { kind: "donations_second" },
    });
    const record = next.data.weekRecords[0];
    expect(record?.conductorMemberId).toBe("m1");
    expect(record?.conductorRule).toEqual(R4.conductorRule);
    expect(record?.vipRule).toEqual({ kind: "donations_second" });
  });

  it("restamps a leftover rule when the member stays eligible for the board", () => {
    const pif: DayRules = {
      conductorRule: { kind: "price_is_freight", board: "weekday" },
      vipRule: null,
    };
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", pif)],
      weekRecords: [
        conductorRecord("2026-06-10", {
          conductorRule: R3_WHEEL.conductorRule,
          conductorMemberName: "CAIPIRA",
        }),
      ],
      roster: [{ memberId: "m1", allianceRank: 3 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], {
      conductorRule: pif.conductorRule,
    });
    const record = next.data.weekRecords[0];
    expect(record?.conductorMemberId).toBe("m1");
    expect(record?.conductorRule).toEqual(pif.conductorRule);
  });

  it("clears an unlocked leftover who is ineligible for the already-painted board", () => {
    const pif: DayRules = {
      conductorRule: { kind: "price_is_freight", board: "weekday" },
      vipRule: null,
    };
    const snap = snapshot({
      dayConfigs: [dayConfig("2026-06-10", pif)],
      weekRecords: [
        conductorRecord("2026-06-10", {
          conductorRule: R4.conductorRule,
          conductorMemberName: "CAIPIRA",
        }),
      ],
      roster: [{ memberId: "m1", allianceRank: 4 }],
    });

    const next = applyOptimisticPaint(snap, ["2026-06-10"], {
      conductorRule: pif.conductorRule,
    });
    const record = next.data.weekRecords[0];
    expect(record?.conductorMemberId).toBeNull();
    expect(record?.conductorRule).toEqual(pif.conductorRule);
  });
});
