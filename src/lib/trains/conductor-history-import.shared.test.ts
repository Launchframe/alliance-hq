import { describe, expect, it } from "vitest";

import {
  calendarDayDiff,
  classifyHistoryImportRow,
  historyImportRowIsCommitable,
  insertBlankLinesBefore,
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
  });

  it("flags a gap, re-bases onto the labeled date, and keeps later rows aligned", () => {
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
    expect(rows[0]?.flags).toEqual([]);
    expect(rows[1]?.flags).toEqual([]);
    expect(rows[2]?.flags).toEqual(["date_conflict"]);
    expect(rows[2]?.date).toBe("2026-07-17");
    expect(rows[2]?.anchorConflict).toEqual({
      labeledDate: "2026-07-17",
      expectedDate: "2026-07-24",
      missingDayCount: 7,
    });
  });

  it("flags only the mismatched end anchor on a long sequential list", () => {
    const lines = parseHistoryPaste(`Redd (July 26)
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
Podzilla (July 12)
Control and Kaos
EagleTN (july 10)
EG (July 9)
dc117
orbs
SheRa
Manbridge
Grimlock
Red Ranger
Fighter
Aline
Crazy
CAIPIRA
justsarah
Nevaskina
JBeazy
Slackin
Mew2407
Eagle (june 22)
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(hasGap).toBe(true);
    const conflictRows = rows.filter((row) =>
      row.flags.includes("date_conflict"),
    );
    expect(conflictRows).toHaveLength(1);
    expect(conflictRows[0]?.name).toBe("Eagle");
    expect(conflictRows[0]?.date).toBe("2026-06-22");
    expect(conflictRows[0]?.anchorConflict).toEqual({
      labeledDate: "2026-06-22",
      expectedDate: "2026-06-23",
      missingDayCount: 1,
    });
  });

  it("re-bases after a gap and can flag a later gap independently", () => {
    const lines = parseHistoryPaste(`A (July 10)
B
C (July 7)
D
E (July 4)
`);
    const { rows, hasGap } = interpolateHistoryDates({
      lines,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(hasGap).toBe(true);
    expect(rows[2]?.anchorConflict).toEqual({
      labeledDate: "2026-07-07",
      expectedDate: "2026-07-08",
      missingDayCount: 1,
    });
    expect(rows[2]?.date).toBe("2026-07-07");
    expect(rows[3]?.date).toBe("2026-07-06");
    expect(rows[4]?.anchorConflict).toEqual({
      labeledDate: "2026-07-04",
      expectedDate: "2026-07-05",
      missingDayCount: 1,
    });
    expect(rows[4]?.date).toBe("2026-07-04");
  });

  it("clears a gap after inserting the suggested blank rows", () => {
    const gapped = parseHistoryPaste(`Redd (July 26)
SlowRider
Eagle (july 23)
`);
    const gappedResult = interpolateHistoryDates({
      lines: gapped,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(gappedResult.rows[2]?.anchorConflict?.missingDayCount).toBe(1);

    const patched = insertBlankLinesBefore(
      gapped,
      2,
      gappedResult.rows[2]!.anchorConflict!.missingDayCount,
    );
    const second = interpolateHistoryDates({
      lines: patched,
      today: "2026-07-27",
      defaultYear: 2026,
    });
    expect(second.hasGap).toBe(false);
    expect(second.rows[2]?.blank).toBe(true);
    expect(second.rows[2]?.date).toBe("2026-07-24");
    expect(second.rows[3]?.name).toBe("Eagle");
    expect(second.rows[3]?.date).toBe("2026-07-23");
    expect(second.rows[3]?.flags).toEqual([]);
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

describe("insertBlankLinesBefore", () => {
  it("inserts blank placeholders before an index", () => {
    const lines = parseHistoryPaste(`A\nB`);
    const next = insertBlankLinesBefore(lines, 1, 2);
    expect(next).toHaveLength(4);
    expect(next[1]?.blank).toBe(true);
    expect(next[2]?.blank).toBe(true);
    expect(next[3]?.name).toBe("B");
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
      classifyHistoryImportRow({
        date: "2026-07-23",
        flags: ["blank"],
        memberId: null,
        blank: true,
        existing: null,
      }),
    ).toBe("blank");

    expect(
      classifyHistoryImportRow({
        date: "2026-06-01",
        flags: [],
        memberId: "m-former",
        memberInactive: true,
        existing: undefined,
      }),
    ).toBe("inactive_member");

    expect(historyImportRowIsCommitable("ready")).toBe(true);
    expect(historyImportRowIsCommitable("inactive_member")).toBe(true);
    expect(historyImportRowIsCommitable("overwrite_draft")).toBe(true);
    expect(historyImportRowIsCommitable("conflict_locked")).toBe(false);
    expect(historyImportRowIsCommitable("already_locked")).toBe(false);
    expect(historyImportRowIsCommitable("blank")).toBe(false);
    expect(historyImportRowIsCommitable("unmatched")).toBe(false);
  });
});
