import { describe, expect, it } from "vitest";

import {
  VS_DEMOTION_TASK_KIND,
  VS_KICK_TASK_KIND,
  evaluateVsWeekOutcome,
  effectiveVsMembershipThreshold,
  isVsWeekExcusedByTimeOff,
  officerTaskStatusForOutcome,
  previousVsWeekRange,
  timeOffEntryExcusesVsWeek,
  type TimeOffExcusalCandidate,
  vsComplianceTaskKindForStrike,
  vsWeekEndingFromMonday,
} from "@/lib/vs-compliance/evaluate.shared";

function timeOffEntry(
  overrides: Partial<TimeOffExcusalCandidate> = {},
): TimeOffExcusalCandidate {
  return {
    startDate: "2026-08-03",
    endDate: "2026-08-08",
    activityScope: "vs",
    availability: "full_away",
    entryKind: "planned",
    ...overrides,
  };
}

describe("vs-compliance/evaluate.shared", () => {
  describe("effectiveVsMembershipThreshold", () => {
    it("applies leeway as a floor", () => {
      expect(effectiveVsMembershipThreshold(1_000_000, 10)).toBe(900_000);
      expect(effectiveVsMembershipThreshold(1_000_000, 0)).toBe(1_000_000);
      expect(effectiveVsMembershipThreshold(0, 50)).toBe(0);
    });
  });

  describe("previousVsWeekRange / vsWeekEndingFromMonday", () => {
    it("resolves the Mon–Sat week before the current calendar week", () => {
      // 2026-08-10 is a Monday; the previously completed week is
      // 2026-08-03 (Mon) – 2026-08-08 (Sat), ending Sunday 2026-08-09.
      const result = previousVsWeekRange("2026-08-10");
      expect(result).toEqual({
        weekStartMonday: "2026-08-03",
        weekEndSaturday: "2026-08-08",
        weekEnding: "2026-08-09",
      });
    });

    it("derives the same week-ending date from the Monday helper", () => {
      expect(vsWeekEndingFromMonday("2026-08-03")).toBe("2026-08-09");
    });
  });

  describe("timeOffEntryExcusesVsWeek / isVsWeekExcusedByTimeOff", () => {
    const weekStartMonday = "2026-08-03";
    const weekEndSaturday = "2026-08-08";

    it("excuses an overlapping planned entry with vs scope", () => {
      expect(
        timeOffEntryExcusesVsWeek(timeOffEntry(), weekStartMonday, weekEndSaturday),
      ).toBe(true);
    });

    it("excuses an overlapping officer_marked entry with all scope", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ entryKind: "officer_marked", activityScope: "all" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(true);
    });

    it("does not excuse an unexpected absence (logged after the fact)", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ entryKind: "unexpected" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });

    it("does not excuse a donation-only scope entry", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ activityScope: "donation" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });

    it("does not excuse when the member opted to still cover minimums", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ availability: "minimums" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });

    it("does not excuse an entry entirely before the week", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ startDate: "2026-07-20", endDate: "2026-07-25" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });

    it("does not excuse an entry entirely after the week", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ startDate: "2026-08-15", endDate: "2026-08-20" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });

    it("excuses a partial overlap that starts before the week and ends mid-week", () => {
      expect(
        timeOffEntryExcusesVsWeek(
          timeOffEntry({ startDate: "2026-08-01", endDate: "2026-08-04" }),
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(true);
    });

    it("isVsWeekExcusedByTimeOff returns true when any entry qualifies", () => {
      expect(
        isVsWeekExcusedByTimeOff(
          [
            timeOffEntry({ entryKind: "unexpected" }),
            timeOffEntry({ activityScope: "vs" }),
          ],
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(true);
    });

    it("isVsWeekExcusedByTimeOff returns false with no qualifying entries", () => {
      expect(
        isVsWeekExcusedByTimeOff(
          [timeOffEntry({ entryKind: "unexpected" })],
          weekStartMonday,
          weekEndSaturday,
        ),
      ).toBe(false);
    });
  });

  describe("evaluateVsWeekOutcome", () => {
    it("is ok when score meets the effective threshold", () => {
      const result = evaluateVsWeekOutcome({
        score: 900_000,
        minPoints: 1_000_000,
        leewayPct: 10,
        excused: false,
        priorMissCount: 0,
      });
      expect(result).toEqual({ threshold: 900_000, outcome: "ok", strikeNumber: null });
    });

    it("is ok when excused even if the score misses", () => {
      const result = evaluateVsWeekOutcome({
        score: 0,
        minPoints: 1_000_000,
        leewayPct: 0,
        excused: true,
        priorMissCount: 2,
      });
      expect(result).toEqual({ threshold: 1_000_000, outcome: "ok", strikeNumber: null });
    });

    it("is a miss with strike 1 when this is the first miss", () => {
      const result = evaluateVsWeekOutcome({
        score: 500_000,
        minPoints: 1_000_000,
        leewayPct: 0,
        excused: false,
        priorMissCount: 0,
      });
      expect(result).toEqual({ threshold: 1_000_000, outcome: "miss", strikeNumber: 1 });
    });

    it("increments the strike number based on prior non-waived misses", () => {
      const result = evaluateVsWeekOutcome({
        score: 500_000,
        minPoints: 1_000_000,
        leewayPct: 0,
        excused: false,
        priorMissCount: 2,
      });
      expect(result).toEqual({ threshold: 1_000_000, outcome: "miss", strikeNumber: 3 });
    });
  });

  describe("vsComplianceTaskKindForStrike", () => {
    it("recommends demotion below the kick strike threshold", () => {
      expect(vsComplianceTaskKindForStrike(1, 3)).toBe(VS_DEMOTION_TASK_KIND);
      expect(vsComplianceTaskKindForStrike(2, 3)).toBe(VS_DEMOTION_TASK_KIND);
    });

    it("recommends kick once strikes reach the configured limit", () => {
      expect(vsComplianceTaskKindForStrike(3, 3)).toBe(VS_KICK_TASK_KIND);
      expect(vsComplianceTaskKindForStrike(5, 3)).toBe(VS_KICK_TASK_KIND);
    });
  });

  describe("officerTaskStatusForOutcome", () => {
    it("maps outcomes to officer task status", () => {
      expect(officerTaskStatusForOutcome("ok")).toBe("none");
      expect(officerTaskStatusForOutcome("miss")).toBe("open");
      expect(officerTaskStatusForOutcome("waived")).toBe("waived");
    });
  });
});
