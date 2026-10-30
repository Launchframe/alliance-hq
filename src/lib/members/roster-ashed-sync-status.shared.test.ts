import { describe, expect, it } from "vitest";

import {
  isRosterAshedSyncRunningStale,
  ROSTER_ASHED_SYNC_STALE_RUNNING_MS,
  serializeAshedRosterSyncState,
} from "@/lib/members/roster-ashed-sync-status.shared";

describe("roster-ashed-sync-status.shared", () => {
  it("treats missing startedAt as stale running", () => {
    expect(isRosterAshedSyncRunningStale(null)).toBe(true);
  });

  it("detects stale running leases", () => {
    const now = Date.parse("2026-07-07T12:00:00.000Z");
    const fresh = new Date(now - 60_000);
    const stale = new Date(now - ROSTER_ASHED_SYNC_STALE_RUNNING_MS - 1);
    expect(isRosterAshedSyncRunningStale(fresh, now)).toBe(false);
    expect(isRosterAshedSyncRunningStale(stale, now)).toBe(true);
  });

  it("serializes known statuses and falls back to idle", () => {
    expect(
      serializeAshedRosterSyncState({
        status: "running",
        startedAt: new Date("2026-07-07T12:00:00.000Z"),
        finishedAt: null,
        lastErrorCode: null,
      }),
    ).toEqual({
      status: "running",
      startedAt: "2026-07-07T12:00:00.000Z",
      finishedAt: null,
      lastErrorCode: null,
    });

    expect(
      serializeAshedRosterSyncState({
        status: "bogus",
        startedAt: null,
        finishedAt: null,
        lastErrorCode: "x",
      }).status,
    ).toBe("idle");
  });
});
