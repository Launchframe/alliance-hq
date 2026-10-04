import { describe, expect, it } from "vitest";

import {
  buildWeeklyPifBoard,
  type WeeklyPifCandidate,
  type WeeklyPifDay,
} from "./weekly-pif.shared";

const WEEK = "2026-09-21";
const TODAY = "2026-09-23";
const dates = [
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
];

type DaySpec = {
  pif: boolean;
  scores?: Record<string, number>;
  eligible?: string[];
};

function day(index: number, spec: DaySpec): WeeklyPifDay {
  return {
    scoreDate: dates[index]!,
    trainDate: dates[index]!,
    isPifWeekday: spec.pif,
    scores: new Map(Object.entries(spec.scores ?? {})),
    eligibleMemberIds: new Set(spec.eligible ?? []),
  };
}

function days(specs: DaySpec[]): WeeklyPifDay[] {
  return specs.map((spec, i) => day(i, spec));
}

const BASE: DaySpec[] = [
  { pif: true, scores: {}, eligible: [] },
  { pif: true, scores: {}, eligible: [] },
  { pif: false, scores: {}, eligible: [] },
  { pif: false, scores: {}, eligible: [] },
  { pif: false, scores: {}, eligible: [] },
  { pif: false, scores: {}, eligible: [] },
];

describe("buildWeeklyPifBoard", () => {
  const two = { pif: true, eligible: ["a", "b", "c"] } as const;

  it("ranks by exact total excess; A ahead of B; missing-day member excluded", () => {
    const specs = [
      {
        pif: true,
        scores: { a: 7_200_000, b: 7_201_001, c: 7_205_000 },
        eligible: ["a", "b", "c"],
      },
      {
        pif: true,
        scores: { a: 7_202_000, b: 7_201_001 },
        eligible: ["a", "b", "c"],
      },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [
        { memberId: "a", memberName: "A" },
        { memberId: "b", memberName: "B" },
        { memberId: "c", memberName: "C" },
      ],
      days: days(specs as DaySpec[]),
      viewerMemberId: "b",
    });
    expect(board.countedDates).toEqual([dates[0], dates[1]]);
    expect(board.entries.map((e) => e.memberId)).toEqual(["a", "b"]);
    expect(board.entries[0]!.totalExcess).toBe("2000");
    expect(board.entries[0]!.averageExcess).toBe(1000);
    expect(board.entries[1]!.totalExcess).toBe("2002");
    expect(board.entries[1]!.averageExcess).toBe(1001);
    expect(board.entries[1]!.isViewer).toBe(true);
    expect(board.entries[0]!.isViewer).toBe(false);
    expect(board.provisional).toBe(false);
    expect(board.scheduledDates).toEqual([dates[0], dates[1]]);
  });

  it("excludes members below the 7.2M floor on any counted day", () => {
    const specs = [
      { ...two, scores: { a: 7_199_999, b: 7_200_000 } },
      { ...two, scores: { a: 7_300_000, b: 7_200_000 } },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [
        { memberId: "a", memberName: "A" },
        { memberId: "b", memberName: "B" },
      ],
      days: days(specs as DaySpec[]),
    });
    expect(board.entries.map((e) => e.memberId)).toEqual(["b"]);
  });

  it("excludes members missing from eligibleMemberIds on a counted day", () => {
    const specs = [
      { pif: true, scores: { a: 7_200_000 }, eligible: ["a"] },
      { pif: true, scores: { a: 7_200_000 }, eligible: [] },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [{ memberId: "a", memberName: "A" }],
      days: days(specs),
    });
    expect(board.entries).toHaveLength(0);
  });

  it("counts only days with score evidence; empty day makes board provisional", () => {
    const specs: DaySpec[] = [
      { pif: true, scores: { a: 7_210_000 }, eligible: ["a"] },
      { pif: true, scores: {}, eligible: ["a"] },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [{ memberId: "a", memberName: "A" }],
      days: days(specs),
    });
    expect(board.countedDates).toEqual([dates[0]]);
    expect(board.missingDates).toEqual([dates[1]]);
    expect(board.provisional).toBe(true);
    expect(board.entries[0]!.daysCounted).toBe(1);
    expect(board.entries[0]!.averageExcess).toBe(10_000);
  });

  it("caps at 10 entries: 3 podium + 7 remaining", () => {
    const candidates: WeeklyPifCandidate[] = Array.from(
      { length: 12 },
      (_, i) => ({ memberId: `m${i}`, memberName: `M${i}` }),
    );
    const scores = Object.fromEntries(
      candidates.map((c, i) => [c.memberId, 7_200_000 + i]),
    );
    const eligible = candidates.map((c) => c.memberId);
    const specs = [
      { pif: true, scores, eligible },
      { pif: true, scores, eligible },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates,
      days: days(specs),
    });
    expect(board.entries).toHaveLength(10);
    expect(board.podium).toHaveLength(3);
    expect(board.remaining).toHaveLength(7);
    expect(board.entries[0]!.memberId).toBe("m0");
    expect(board.entries[9]!.memberId).toBe("m9");
  });

  it("deterministic name-then-id tie order", () => {
    const specs = [
      { pif: true, scores: { b: 7_200_001, a: 7_200_001 }, eligible: ["a", "b"] },
      { pif: true, scores: { b: 7_200_001, a: 7_200_001 }, eligible: ["a", "b"] },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [
        { memberId: "b", memberName: "Alpha" },
        { memberId: "a", memberName: "Alpha" },
      ],
      days: days(specs),
    });
    expect(board.entries.map((e) => e.memberId)).toEqual(["a", "b"]);
  });

  it("throws on duplicate member or duplicate score date", () => {
    const spec = { pif: true, scores: { a: 7_200_001 }, eligible: ["a"] };
    const all = days([spec, spec, { pif: false }, { pif: false }, { pif: false }, { pif: false }]);
    expect(() =>
      buildWeeklyPifBoard({
        weekStart: WEEK,
        serverToday: TODAY,
        candidates: [
          { memberId: "a", memberName: "A" },
          { memberId: "a", memberName: "A2" },
        ],
        days: all,
      }),
    ).toThrow();
    const dupDates = [
      day(0, spec),
      { ...day(0, spec), scoreDate: dates[0]! },
      day(2, { pif: false }),
      day(3, { pif: false }),
      day(4, { pif: false }),
      day(5, { pif: false }),
    ];
    expect(() =>
      buildWeeklyPifBoard({
        weekStart: WEEK,
        serverToday: TODAY,
        candidates: [{ memberId: "a", memberName: "A" }],
        days: dupDates,
      }),
    ).toThrow();
  });

  it("throws on unsafe or non-integer scores", () => {
    for (const score of [Number.MAX_SAFE_INTEGER + 1, 1.5]) {
      const specs = [
        { pif: true, scores: { a: score }, eligible: ["a"] },
        { pif: true, scores: { a: 7_200_001 }, eligible: ["a"] },
        { pif: false },
        { pif: false },
        { pif: false },
        { pif: false },
      ];
      expect(() =>
        buildWeeklyPifBoard({
          weekStart: WEEK,
          serverToday: TODAY,
          candidates: [{ memberId: "a", memberName: "A" }],
          days: days(specs),
        }),
      ).toThrow();
    }
  });

  it("returns empty entries when no completed day has evidence", () => {
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [{ memberId: "a", memberName: "A" }],
      days: days(BASE),
    });
    expect(board.entries).toHaveLength(0);
    expect(board.countedDates).toHaveLength(0);
    expect(board.provisional).toBe(true);
  });

  it("does not count the in-progress PIF day even when scores exist", () => {
    const specs = [
      { pif: true, scores: { a: 7_210_000 }, eligible: ["a"] },
      { pif: true, scores: { a: 7_250_000 }, eligible: ["a"] },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: dates[1]!,
      candidates: [{ memberId: "a", memberName: "A" }],
      days: days(specs),
    });
    expect(board.countedDates).toEqual([dates[0]]);
    expect(board.missingDates).toEqual([dates[1]]);
    expect(board.provisional).toBe(true);
    expect(board.entries[0]!.totalExcess).toBe("10000");
    expect(board.entries[0]!.daysCounted).toBe(1);
  });

  it("non-PIF (heavy-hitter) days are never counted", () => {
    const specs = [
      { pif: false, scores: { a: 9_000_000 }, eligible: ["a"] },
      { pif: true, scores: { a: 7_210_000 }, eligible: ["a"] },
      { pif: false },
      { pif: false },
      { pif: false },
      { pif: false },
    ];
    const board = buildWeeklyPifBoard({
      weekStart: WEEK,
      serverToday: TODAY,
      candidates: [{ memberId: "a", memberName: "A" }],
      days: days(specs),
    });
    expect(board.scheduledDates).toEqual([dates[1]]);
    expect(board.entries[0]!.averageExcess).toBe(10_000);
  });
});
