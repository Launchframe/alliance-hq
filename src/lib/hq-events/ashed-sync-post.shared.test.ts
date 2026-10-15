import { describe, expect, it } from "vitest";

import {
  EVENT_SYNC_LEASE_MS,
  EVENT_SYNC_POST_TIMEOUT_MS,
  eventSyncUncertainLeasePatch,
  shouldRetainEventSyncLeaseAfterUncertainPost,
} from "./ashed-sync-post.shared";

describe("event Ashed sync POST vs lease fence", () => {
  /**
   * BUG REPRO (pre-fix): `base44EntityPost` had no AbortSignal while
   * `LEASE_MS` was 60s. A hung POST outlived the lease → peer reclaim →
   * second create → permanent `duplicate_remote`.
   */
  it("bounds the create POST strictly inside the lease window", () => {
    expect(EVENT_SYNC_POST_TIMEOUT_MS).toBeLessThan(EVENT_SYNC_LEASE_MS);
    expect(EVENT_SYNC_POST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("retains the lease fence after abort/timeout/5xx uncertainty", () => {
    expect(
      shouldRetainEventSyncLeaseAfterUncertainPost({ statusCode: null }),
    ).toBe(true);
    expect(
      shouldRetainEventSyncLeaseAfterUncertainPost({ statusCode: undefined }),
    ).toBe(true);
    expect(
      shouldRetainEventSyncLeaseAfterUncertainPost({ statusCode: 503 }),
    ).toBe(true);
  });

  it("does not retain the lease after definitive 4xx failures", () => {
    expect(
      shouldRetainEventSyncLeaseAfterUncertainPost({ statusCode: 400 }),
    ).toBe(false);
    expect(
      shouldRetainEventSyncLeaseAfterUncertainPost({ statusCode: 409 }),
    ).toBe(false);
  });

  it("keeps retryAt at lease expiry when retaining (blocks peer reclaim)", () => {
    const now = new Date("2026-10-12T02:00:00.000Z");
    const leaseExpiresAt = new Date("2026-10-12T02:01:00.000Z");
    expect(
      eventSyncUncertainLeasePatch({
        leaseExpiresAt,
        now,
        retainLease: true,
      }),
    ).toEqual({ clearLease: false, retryAt: leaseExpiresAt });
  });

  it("clears the lease when not retaining or when the window already ended", () => {
    const now = new Date("2026-10-12T02:00:00.000Z");
    const expired = new Date("2026-10-12T01:59:00.000Z");
    expect(
      eventSyncUncertainLeasePatch({
        leaseExpiresAt: expired,
        now,
        retainLease: true,
      }),
    ).toEqual({
      clearLease: true,
      retryAt: new Date("2026-10-12T02:01:00.000Z"),
    });
    expect(
      eventSyncUncertainLeasePatch({
        leaseExpiresAt: new Date("2026-10-12T02:01:00.000Z"),
        now,
        retainLease: false,
      }),
    ).toEqual({
      clearLease: true,
      retryAt: new Date("2026-10-12T02:01:00.000Z"),
    });
  });
});
