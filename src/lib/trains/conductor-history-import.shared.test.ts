import { describe, expect, it } from "vitest";

import {
  calendarDayDiff,
  classifyHistoryImportRow,
  historyImportRowIsCommitable,
  interpolateHistoryDates,
  parseHistoryPaste,
} from "@/lib/trains/conductor-history-import.shared";

const SAMPLE = `Alliance trains
Redd (July 26)
SlowRider
blackmilk
orbs
Fighter55555
Crazy
BOGGLE
Sgt Painmaker
Happy
EG (july 17)
Truth
Podz
Cindy
elsa
Podz
Control and Kaos
Eagle (July 10)
`;

describe("parseHistoryPaste", () => {
  it("skips headers and parses optional month-day anchors", () => {
    const lines = parseHistoryPaste(SAMPLE);
    expect(lines).toHaveLength(17);
    expect(lines[0]).toMatchObject({
      name: "Redd",
      anchorMonth: 7,
      anchorDay: 26,
    });
    expect(lines[9]).toMatchObject({
      name: "EG",
      anchorMonth: 7,
      anchorDay: 17,
    });
    expect(lines[1]).toMatchObject({ name: "SlowRider" });
    expect(lines[1]?.anchorMonth).toBeUndefined();
    expect(lines[15]).toMatchObject({ name: "Control and Kaos" });
  });

  it("parses optional year in the anchor", () => {
    const [line] = parseHistoryPaste("Redd (July 26, 2025)");
    expect(line).toMatchObject({
      name: "Redd",
      anchorMonth: 7,
      anchorDay: 26,
      anchorYear: 2025,
    });
  });
});

describe("calendarDayDiff", () => {
  it("counts exclusive steps between descending dates", () => {
    expect(calendarDayDiff("2026-07-26", "2026-07-17")).toBe(9);
    expect(calendarDayDiff("2026-07-26", "2026-07-10")).toBe(16);
  });
});

describe("interpolateHistoryDates", () => {
  it("fills the sample list from July 26 down to July 10", () => {
    const lines = parseHistoryPaste(SAMPLE);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(hasGap).toBe(false);
    expect(rows).toHaveLength(17);
    expect(rows[0]).toMatchObject({ name: "Redd", date: "2026-07-26", flags: [] });
    expect(rows[9]).toMatchObject({ name: "EG", date: "2026-07-17", flags: [] });
    expect(rows[16]).toMatchObject({
      name: "Eagle",
      date: "2026-07-10",
      flags: [],
    });
    expect(rows.map((r) => r.date)).toEqual([
      "2026-07-26",
      "2026-07-25",
      "2026-07-24",
      "2026-07-23",
      "2026-07-22",
      "2026-07-21",
      "2026-07-20",
      "2026-07-19",
      "2026-07-18",
      "2026-07-17",
      "2026-07-16",
      "2026-07-15",
      "2026-07-14",
      "2026-07-13",
      "2026-07-12",
      "2026-07-11",
      "2026-07-10",
    ]);
  });

  it("flags a gap when name count does not match the date span", () => {
    const lines = parseHistoryPaste(`A (July 26)
B
C (July 17)
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(hasGap).toBe(true);
    expect(rows.every((r) => r.flags.includes("gap"))).toBe(true);
  });

  it("uses newest date alone and infers older days from list length", () => {
    const lines = parseHistoryPaste(`Redd
SlowRider
Eagle
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
      firstDate: "2026-07-26",
    });
    expect(hasGap).toBe(false);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-07-26",
      "2026-07-25",
      "2026-07-24",
    ]);
  });

  it("fills from a single first-line text anchor without an end date", () => {
    const lines = parseHistoryPaste(`Redd (July 26)
SlowRider
Eagle
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(hasGap).toBe(false);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-07-26",
      "2026-07-25",
      "2026-07-24",
    ]);
  });

  it("still accepts an optional lastDate override when provided", () => {
    const lines = parseHistoryPaste(`Redd
SlowRider
Eagle
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
      firstDate: "2026-07-26",
      lastDate: "2026-07-24",
    });
    expect(hasGap).toBe(false);
    expect(rows.map((r) => r.date)).toEqual([
      "2026-07-26",
      "2026-07-25",
      "2026-07-24",
    ]);
  });

  it("flags today and future dates as not_past", () => {
    const lines = parseHistoryPaste(`Redd (July 27)
Eagle
`);
    const { rows } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(rows[0]?.flags).toContain("not_past");
    expect(rows[1]?.date).toBe("2026-07-26");
  });

  it("flags missing dates when no newest anchor exists", () => {
    const lines = parseHistoryPaste(`Redd
SlowRider
`);
    const { rows } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(rows.every((r) => r.flags.includes("missing_date"))).toBe(true);
  });
});

describe("classifyHistoryImportRow", () => {
  it("classifies locked same/different and draft overwrite", () => {
    expect(
      classifyHistoryImportRow({
        date: "2026-07-10",
        flags: [],
        memberId: "m1",
        existing: {
          date: "2026-07-10",
          conductorMemberId: "m1",
          conductorMemberName: "Eagle",
          lockedAt: "2026-07-10T12:00:00.000Z",
        },
      }),
    ).toBe("already_locked");

    expect(
      classifyHistoryImportRow({
        date: "2026-07-10",
        flags: [],
        memberId: "m2",
        existing: {
          date: "2026-07-10",
          conductorMemberId: "m1",
          conductorMemberName: "Eagle",
          lockedAt: "2026-07-10T12:00:00.000Z",
        },
      }),
    ).toBe("conflict_locked");

    expect(
      classifyHistoryImportRow({
        date: "2026-07-10",
        flags: [],
        memberId: "m2",
        existing: {
          date: "2026-07-10",
          conductorMemberId: "m1",
          conductorMemberName: "Eagle",
          lockedAt: null,
        },
      }),
    ).toBe("overwrite_draft");

    expect(
      historyImportRowIsCommitable("ready"),
    ).toBe(true);
    expect(historyImportRowIsCommitable("overwrite_draft")).toBe(true);
    expect(historyImportRowIsCommitable("conflict_locked")).toBe(false);
    expect(historyImportRowIsCommitable("already_locked")).toBe(false);
  });
});
