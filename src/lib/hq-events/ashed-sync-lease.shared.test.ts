import { describe, expect, it } from "vitest";

import {
  flagBoardItemsMayTouchLease,
  isEventSyncLeaseLive,
} from "./ashed-sync-lease.shared";

describe("isEventSyncLeaseLive", () => {
  const now = new Date("2026-10-11T08:00:00.000Z");

  it("is false when no lease is set (claimable / flaggable)", () => {
    expect(isEventSyncLeaseLive(null, now)).toBe(false);
    expect(isEventSyncLeaseLive(undefined, now)).toBe(false);
  });

  it("is false when the lease already expired (peer may reclaim)", () => {
    expect(
      isEventSyncLeaseLive(new Date("2026-10-11T07:59:59.000Z"), now),
    ).toBe(false);
  });

  it("is true while the lease window is still open", () => {
    expect(
      isEventSyncLeaseLive(new Date("2026-10-11T08:01:00.000Z"), now),
    ).toBe(true);
  });
});

describe("flagBoardItemsMayTouchLease", () => {
  const now = new Date("2026-10-11T08:00:00.000Z");

  /**
   * Red scenario (pre-fix): flagBoardItems cleared leaseToken on every
   * pending row, including one mid-base44EntityPost. A peer then claimed and
   * POSTed again → duplicate Ashed scores / permanent duplicate_remote.
   */
  it("refuses to clear a live in-flight lease (prevents mid-POST steal)", () => {
    expect(
      flagBoardItemsMayTouchLease({
        leaseExpiresAt: new Date("2026-10-11T08:00:30.000Z"),
        now,
      }),
    ).toBe(false);
  });

  it("allows flagging rows with no lease or an expired lease", () => {
    expect(flagBoardItemsMayTouchLease({ leaseExpiresAt: null, now })).toBe(
      true,
    );
    expect(
      flagBoardItemsMayTouchLease({
        leaseExpiresAt: new Date("2026-10-11T07:59:00.000Z"),
        now,
      }),
    ).toBe(true);
  });
});
