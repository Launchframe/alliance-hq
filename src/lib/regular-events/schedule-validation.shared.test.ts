import { describe, expect, it } from "vitest";

import {
  calendarDayDistance,
  expandBiweeklySlotsToDates,
  expandWeeklySlotsToDates,
  isBiweeklyOnWeek,
  validateAllianceExerciseDates,
  validateEventScheduleDates,
  validateOncePerWeekDates,
  validateSkyGlacierAlternating,
  validateWedFriOnly,
  validateWeeklySlotsForEvent,
  validateZombieSiegeDates,
} from "@/lib/regular-events/schedule-validation.shared";
import { defaultRulesForAlliance } from "@/lib/regular-events/schedule.shared";
import { getWeekStartMonday } from "@/lib/trains/game-time";

describe("calendarDayDistance", () => {
  it("counts inclusive gap between ST dates", () => {
    expect(calendarDayDistance("2026-09-07", "2026-09-07")).toBe(0);
    expect(calendarDayDistance("2026-09-07", "2026-09-08")).toBe(1);
    expect(calendarDayDistance("2026-09-07", "2026-09-10")).toBe(3);
  });
});

describe("validateAllianceExerciseDates", () => {
  it("rejects adjacent days", () => {
    const result = validateAllianceExerciseDates([
      "2026-09-07",
      "2026-09-08",
    ]);
    expect(result).toEqual({
      ok: false,
      code: "adjacent_days",
      eventKey: "marshal_guard",
    });
  });

  it("allows every-other-day", () => {
    expect(
      validateAllianceExerciseDates(["2026-09-07", "2026-09-09", "2026-09-11"])
        .ok,
    ).toBe(true);
  });
});

describe("validateZombieSiegeDates", () => {
  it("rejects fewer than two full days between", () => {
    // Mon → Wed = distance 2 (only Tue between)
    expect(
      validateZombieSiegeDates(["2026-09-07", "2026-09-09"]).ok,
    ).toBe(false);
  });

  it("allows Mon + Thu (two full days between)", () => {
    expect(
      validateZombieSiegeDates(["2026-09-07", "2026-09-10"]).ok,
    ).toBe(true);
  });
});

describe("validateOncePerWeekDates", () => {
  it("rejects two Glacierdon dates in the same ST week", () => {
    const mon = getWeekStartMonday("2026-09-09");
    const tue = "2026-09-08"; // ensure same week as a Wed if needed
    void tue;
    const result = validateOncePerWeekDates("glacierdon", [
      "2026-09-09",
      "2026-09-10",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("once_per_week");
    expect(getWeekStartMonday("2026-09-09")).toBe(mon);
  });

  it("allows one per week", () => {
    expect(
      validateOncePerWeekDates("sky_marshall", [
        "2026-09-09",
        "2026-09-16",
      ]).ok,
    ).toBe(true);
  });
});

describe("defaultRulesForAlliance", () => {
  it("default weekly and biweekly slots pass validation", () => {
    const rules = defaultRulesForAlliance(false, "2026-09-09");
    const anchor = "2026-09-07"; // Monday
    for (const rule of rules) {
      if (rule.scheduleKind === "weekly" && rule.weeklySlots) {
        expect(
          validateWeeklySlotsForEvent(
            rule.eventKey,
            rule.weeklySlots,
            anchor,
          ).ok,
        ).toBe(true);
      }
      if (rule.scheduleKind === "biweekly" && rule.weeklySlots) {
        expect(rule.biweeklyPhaseMonday).toBeTruthy();
        expect(
          validateEventScheduleDates(
            rule.eventKey,
            expandBiweeklySlotsToDates(
              rule.weeklySlots,
              rule.biweeklyPhaseMonday!,
              anchor,
              "2026-10-31",
            ),
          ).ok,
        ).toBe(true);
      }
      if (rule.eventKey === "marshal_guard" && rule.intervalDays) {
        const dates = [
          "2026-09-07",
          "2026-09-09",
          "2026-09-11",
          "2026-09-13",
        ];
        expect(validateEventScheduleDates("marshal_guard", dates).ok).toBe(
          true,
        );
      }
    }
    const sky = rules.find((r) => r.eventKey === "sky_marshall");
    const glacier = rules.find((r) => r.eventKey === "glacierdon");
    expect(sky?.scheduleKind).toBe("biweekly");
    expect(glacier?.scheduleKind).toBe("biweekly");
    expect(sky?.biweeklyPhaseMonday).not.toBe(glacier?.biweeklyPhaseMonday);
  });
});

describe("expandWeeklySlotsToDates", () => {
  it("expands Mon+Thu slots", () => {
    const dates = expandWeeklySlotsToDates(
      [
        { dow: 1, timeSt: "23:00" },
        { dow: 4, timeSt: "23:00" },
      ],
      "2026-09-07",
      "2026-09-13",
    );
    expect(dates).toEqual(["2026-09-07", "2026-09-10"]);
  });
});

describe("biweekly and sky/glacier constraints", () => {
  it("isBiweeklyOnWeek uses even week distance from phase", () => {
    expect(isBiweeklyOnWeek("2026-09-07", "2026-09-07")).toBe(true);
    expect(isBiweeklyOnWeek("2026-09-14", "2026-09-07")).toBe(false);
    expect(isBiweeklyOnWeek("2026-09-21", "2026-09-07")).toBe(true);
  });

  it("rejects non Wed–Fri for Sky Predator", () => {
    expect(validateWedFriOnly("sky_marshall", ["2026-09-07"]).ok).toBe(false);
    expect(validateWedFriOnly("sky_marshall", ["2026-09-09"]).ok).toBe(true);
  });

  it("rejects shared ST weeks for Sky + Glacierdon", () => {
    const result = validateSkyGlacierAlternating(
      ["2026-09-09"],
      ["2026-09-10"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("alternating_week");
  });
});
