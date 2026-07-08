import { describe, expect, it } from "vitest";

import {
  isRosterAshedSyncStale,
  ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS,
  shouldSyncRosterFromAshed,
} from "./roster-sync.shared";

describe("isRosterAshedSyncStale", () => {
  const now = Date.parse("2026-07-07T12:00:00.000Z");

  it("treats missing last sync as stale", () => {
    expect(isRosterAshedSyncStale(null, now)).toBe(true);
  });

  it("is fresh within the 24h window", () => {
    const lastSyncedAt = new Date(now - ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS + 60_000);
    expect(isRosterAshedSyncStale(lastSyncedAt, now)).toBe(false);
  });

  it("is stale after the 24h window", () => {
    const lastSyncedAt = new Date(now - ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS - 1);
    expect(isRosterAshedSyncStale(lastSyncedAt, now)).toBe(true);
  });
});

describe("shouldSyncRosterFromAshed", () => {
  const fresh = new Date("2026-07-07T10:00:00.000Z");
  const now = Date.parse("2026-07-07T12:00:00.000Z");

  it("syncs on explicit refresh", () => {
    expect(
      shouldSyncRosterFromAshed({
        forceRefresh: true,
        lastSyncedAt: fresh,
        localMemberCount: 120,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("syncs when local roster is empty", () => {
    expect(
      shouldSyncRosterFromAshed({
        forceRefresh: false,
        lastSyncedAt: fresh,
        localMemberCount: 0,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("skips when cache is fresh", () => {
    expect(
      shouldSyncRosterFromAshed({
        forceRefresh: false,
        lastSyncedAt: fresh,
        localMemberCount: 120,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("syncs when cache is stale and roster is non-empty", () => {
    const stale = new Date(now - ROSTER_ASHED_AUTO_SYNC_MAX_AGE_MS - 1);
    expect(
      shouldSyncRosterFromAshed({
        forceRefresh: false,
        lastSyncedAt: stale,
        localMemberCount: 120,
        nowMs: now,
      }),
    ).toBe(true);
  });
});
