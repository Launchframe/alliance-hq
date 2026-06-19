import { describe, expect, it } from "vitest";

import {
  canStartConductorSwap,
  conductorSwapCandidates,
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

  it("excludes the source day and locked target days", () => {
    expect(
      conductorSwapCandidates({
        sourceDate: "2026-06-10",
        dayConfigs: [
          { date: "2026-06-10" },
          { date: "2026-06-11" },
          { date: "2026-06-12" },
        ],
        weekRecords: [
          {
            date: "2026-06-11",
            conductorMemberId: "m2",
            conductorMemberName: "Bob",
            lockedAt: "2026-06-11T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        date: "2026-06-12",
        conductorMemberId: null,
        conductorMemberName: null,
        lockedAt: null,
      },
    ]);
  });
});
