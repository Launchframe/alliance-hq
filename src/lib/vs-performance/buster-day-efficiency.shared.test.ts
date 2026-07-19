import { describe, expect, it } from "vitest";

import {
  BUSTER_DAY_BASELINE_POINTS,
  calendarDayDistance,
  computeBusterDayEfficiencyReport,
  computeBusterDayEfficiencyRow,
  pickClosestByCalendarDate,
} from "./buster-day-efficiency.shared";

describe("computeBusterDayEfficiencyRow", () => {
  it("scores an efficient fighter high (high net VS, modest power loss)", () => {
    const row = computeBusterDayEfficiencyRow({
      commanderId: "c1",
      memberName: "Alpha",
      ashedMemberId: "m1",
      powerStartM: 200,
      powerEndM: 180,
      killsStart: 1_000_000,
      killsEnd: 1_050_000,
      vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS + 2_000_000,
    });
    expect(row.powerLostM).toBe(20);
    expect(row.killsDelta).toBe(50_000);
    expect(row.netVsScore).toBe(2_000_000);
    expect(row.efficiencyRatio).toBeCloseTo(100_000, 5);
    expect(row.noEngagement).toBe(false);
    expect(row.estimatedKillPointsMin).toBe(50_000 * 33);
    expect(row.estimatedKillPointsMax).toBe(50_000 * 165);
  });

  it("scores a fed-troops commander low (score mostly from losses)", () => {
    const row = computeBusterDayEfficiencyRow({
      commanderId: "c2",
      memberName: "Bravo",
      ashedMemberId: "m2",
      powerStartM: 200,
      powerEndM: 50,
      killsStart: 100,
      killsEnd: 120,
      vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS + 500_000,
    });
    expect(row.powerLostM).toBe(150);
    expect(row.netVsScore).toBe(500_000);
    expect(row.efficiencyRatio).toBeCloseTo(500_000 / 150, 5);
    expect(row.noEngagement).toBe(false);
  });

  it("marks shielded non-fighters as no engagement", () => {
    const row = computeBusterDayEfficiencyRow({
      commanderId: "c3",
      memberName: "Charlie",
      ashedMemberId: "m3",
      powerStartM: 100,
      powerEndM: 100,
      killsStart: 10,
      killsEnd: 10,
      vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS,
    });
    expect(row.powerLostM).toBe(0);
    expect(row.netVsScore).toBe(0);
    expect(row.noEngagement).toBe(true);
    expect(row.efficiencyRatio).toBeNull();
  });

  it("floors negative deltas and baseline underflow at zero", () => {
    const row = computeBusterDayEfficiencyRow({
      commanderId: "c4",
      memberName: "Delta",
      ashedMemberId: null,
      powerStartM: 50,
      powerEndM: 60,
      killsStart: 200,
      killsEnd: 150,
      vsScoreSaturday: 1_000,
    });
    expect(row.powerLostM).toBe(0);
    expect(row.killsDelta).toBe(0);
    expect(row.netVsScore).toBe(0);
    expect(row.noEngagement).toBe(true);
  });
});

describe("computeBusterDayEfficiencyReport", () => {
  it("sorts weakest efficiency first and sinks no-engagement", () => {
    const rows = computeBusterDayEfficiencyReport([
      {
        commanderId: "strong",
        memberName: "Zulu",
        ashedMemberId: "z",
        powerStartM: 100,
        powerEndM: 90,
        killsStart: 0,
        killsEnd: 10,
        vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS + 1_000_000,
      },
      {
        commanderId: "weak",
        memberName: "Alpha",
        ashedMemberId: "a",
        powerStartM: 100,
        powerEndM: 10,
        killsStart: 0,
        killsEnd: 1,
        vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS + 100_000,
      },
      {
        commanderId: "idle",
        memberName: "Mike",
        ashedMemberId: "m",
        powerStartM: 80,
        powerEndM: 80,
        killsStart: 5,
        killsEnd: 5,
        vsScoreSaturday: BUSTER_DAY_BASELINE_POINTS,
      },
    ]);
    expect(rows.map((r) => r.commanderId)).toEqual(["weak", "strong", "idle"]);
  });
});

describe("calendarDayDistance / pickClosestByCalendarDate", () => {
  it("picks the nearest recorded date", () => {
    expect(calendarDayDistance("2026-07-17", "2026-07-19")).toBe(2);
    const picked = pickClosestByCalendarDate(
      [
        { recordedDate: "2026-07-10", value: "a" },
        { recordedDate: "2026-07-18", value: "b" },
        { recordedDate: "2026-07-20", value: "c" },
      ],
      "2026-07-19",
      (row) => row.recordedDate,
    );
    expect(picked?.value).toBe("b");
  });
});
