import { describe, expect, it } from "vitest";

import {
  canStartConductorSwap,
  conductorSwapCandidates,
  earliestConductorSwapTargetDate,
  isValidConductorSwapTargetDate,
} from "@/lib/trains/conductor-swap.shared";

describe("conductor swap helpers", () => {
  it("only starts swaps from unlocked conductor drafts", () => {
    expect(
      canStartConductorSwap({
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: null,
      }),
    ).toBe(true);
    expect(
      canStartConductorSwap({
        date: "2026-06-10",
        conductorMemberId: "m1",
        conductorMemberName: "Alice",
        lockedAt: "2026-06-10T12:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      canStartConductorSwap({
        date: "2026-06-10",
        conductorMemberId: null,
        conductorMemberName: null,
        lockedAt: null,
      }),
    ).toBe(false);
  });

  it("returns the next three unlocked future days, spanning week boundaries", () => {
    expect(
      conductorSwapCandidates({
        sourceDate: "2026-06-14",
        today: "2026-06-14",
        weekRecords: [
          {
            date: "2026-06-15",
            conductorMemberId: "m2",
            conductorMemberName: "Bob",
            lockedAt: "2026-06-15T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        date: "2026-06-16",
        conductorMemberId: null,
        conductorMemberName: null,
        lockedAt: null,
      },
      {
        date: "2026-06-17",
        conductorMemberId: null,
        conductorMemberName: null,
        lockedAt: null,
      },
      {
        date: "2026-06-18",
        conductorMemberId: null,
        conductorMemberName: null,
        lockedAt: null,
      },
    ]);
  });

  it("skips the source day when it falls in the upcoming window", () => {
    expect(
      conductorSwapCandidates({
        sourceDate: "2026-06-12",
        today: "2026-06-10",
        weekRecords: [],
        limit: 3,
      }).map((candidate) => candidate.date),
    ).toEqual(["2026-06-11", "2026-06-13", "2026-06-14"]);
  });

  it("attaches known conductor drafts from week records", () => {
    expect(
      conductorSwapCandidates({
        sourceDate: "2026-06-10",
        today: "2026-06-10",
        weekRecords: [
          {
            date: "2026-06-11",
            conductorMemberId: "m2",
            conductorMemberName: "Bob",
            lockedAt: null,
          },
        ],
        limit: 1,
      }),
    ).toEqual([
      {
        date: "2026-06-11",
        conductorMemberId: "m2",
        conductorMemberName: "Bob",
        lockedAt: null,
      },
    ]);
  });

  it("validates picker dates as strictly future and not the source day", () => {
    expect(earliestConductorSwapTargetDate("2026-06-11")).toBe("2026-06-12");
    expect(
      isValidConductorSwapTargetDate({
        targetDate: "2026-06-11",
        sourceDate: "2026-06-10",
        today: "2026-06-11",
      }),
    ).toBe(false);
    expect(
      isValidConductorSwapTargetDate({
        targetDate: "2026-06-12",
        sourceDate: "2026-06-12",
        today: "2026-06-11",
      }),
    ).toBe(false);
    expect(
      isValidConductorSwapTargetDate({
        targetDate: "2026-06-20",
        sourceDate: "2026-06-14",
        today: "2026-06-14",
      }),
    ).toBe(true);
  });
});
