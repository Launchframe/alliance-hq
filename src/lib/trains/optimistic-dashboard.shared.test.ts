import { describe, expect, it } from "vitest";

import {
  applyOptimisticLock,
  applyOptimisticPaint,
  applyOptimisticWeekTemplate,
  patchDayConfigsForDates,
  upsertRecordForDate,
} from "@/lib/trains/optimistic-dashboard.shared";

describe("optimistic dashboard state", () => {
  it("upserts a draft conductor on an empty day", () => {
    const next = upsertRecordForDate([], "2026-06-10", {
      conductorMemberId: "m1",
      conductorMemberName: "Alice",
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.conductorMemberName).toBe("Alice");
  });

  it("paints day configs for a template", () => {
    const painted = patchDayConfigsForDates(
      [
        {
          id: "d1",
          date: "2026-06-10",
          conductorMechanism: "vs_top_10",
          vipMechanism: "conductor_pick",
          vipConfig: null,
          isOverride: false,
        },
      ],
      ["2026-06-10"],
      "economy_week",
    );
    expect(painted[0]?.conductorMechanism).toBe("r3_lottery");
    expect(painted[0]?.isOverride).toBe(true);
    expect(painted[0]?.paintTemplate).toBe("economy_week");
  });

  it("locks a day across schedule views", () => {
    const base = {
      data: {
        today: "2026-06-10",
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        weekRecords: [],
        dayConfigs: [],
      },
      viewedWeek: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        templateType: null,
        dayConfigs: [],
        weekRecords: [],
      },
      viewedMonth: {
        monthKey: "2026-06",
        monthStart: "2026-06-01",
        monthEnd: "2026-06-30",
        dayConfigs: [],
        monthRecords: [],
      },
    } as unknown as Parameters<typeof applyOptimisticLock>[0];

    const locked = applyOptimisticLock(base, "2026-06-10", "2026-06-10T12:00:00.000Z");
    expect(locked.viewedWeek.weekRecords[0]?.lockedAt).toBe(
      "2026-06-10T12:00:00.000Z",
    );
    expect(locked.viewedMonth.monthRecords[0]?.lockedAt).toBe(
      "2026-06-10T12:00:00.000Z",
    );
  });

  it("paints multiple dates in month and week snapshots", () => {
    const base = {
      data: {
        weekRecords: [],
        dayConfigs: [
          {
            id: "d1",
            date: "2026-06-09",
            conductorMechanism: "vs_top_10",
            vipMechanism: "conductor_pick",
            vipConfig: null,
            isOverride: false,
          },
        ],
      },
      viewedWeek: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        templateType: null,
        dayConfigs: [
          {
            id: "d1",
            date: "2026-06-09",
            conductorMechanism: "vs_top_10",
            vipMechanism: "conductor_pick",
            vipConfig: null,
            isOverride: false,
          },
        ],
        weekRecords: [],
      },
      viewedMonth: {
        monthKey: "2026-06",
        monthStart: "2026-06-01",
        monthEnd: "2026-06-30",
        dayConfigs: [
          {
            id: "d1",
            date: "2026-06-09",
            conductorMechanism: "vs_top_10",
            vipMechanism: "conductor_pick",
            vipConfig: null,
            isOverride: false,
          },
        ],
        monthRecords: [],
      },
    } as unknown as Parameters<typeof applyOptimisticPaint>[0];

    const painted = applyOptimisticPaint(base, ["2026-06-09", "2026-06-10"], "economy_week");
    expect(painted.viewedMonth.dayConfigs).toHaveLength(2);
    expect(painted.viewedMonth.dayConfigs.every((d) => d.conductorMechanism === "r3_lottery")).toBe(
      true,
    );
  });

  it("sets templateType on the viewed week when applying a week template", () => {
    const base = {
      data: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        schedule: {
          id: "sched-1",
          weekStart: "2026-06-08",
          templateType: "vs_push_week",
          isPivot: false,
        },
        dayConfigs: [],
        weekRecords: [],
      },
      viewedWeek: {
        weekStart: "2026-06-08",
        weekEnd: "2026-06-14",
        templateType: "vs_push_week" as const,
        dayConfigs: [],
        weekRecords: [],
      },
      viewedMonth: {
        monthKey: "2026-06",
        monthStart: "2026-06-01",
        monthEnd: "2026-06-30",
        dayConfigs: [],
        monthRecords: [],
      },
    } as unknown as Parameters<typeof applyOptimisticWeekTemplate>[0];

    const next = applyOptimisticWeekTemplate(
      base,
      "2026-06-08",
      "economy_week",
      null,
    );
    expect(next.viewedWeek.templateType).toBe("economy_week");
    expect(next.data.schedule?.templateType).toBe("economy_week");
  });
});
