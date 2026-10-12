import { describe, expect, it } from "vitest";
import { isLiveOcrLease } from "./control-lease-live.shared";

const now = new Date("2026-10-11T18:00:00.000Z");
const live = {
  state: "running" as const,
  leaseToken: "tok-live",
  leaseExpiresAt: new Date("2026-10-11T18:05:00.000Z"),
  expiresAt: new Date("2026-10-12T18:00:00.000Z"),
};

describe("isLiveOcrLease", () => {
  it("accepts a running lease before expiry", () => {
    expect(isLiveOcrLease(live, "tok-live", now)).toBe(true);
  });

  it("rejects an expired lease token (fail must not terminalize reclaimable work)", () => {
    // Pre-fix failWorkerJob / failMediaTask only matched token+running and would
    // mark failed here; reclaim via claim* requires state=running + expired lease.
    expect(
      isLiveOcrLease(
        { ...live, leaseExpiresAt: new Date("2026-10-11T17:59:00.000Z") },
        "tok-live",
        now,
      ),
    ).toBe(false);
  });

  it("rejects at exact lease expiry (matches claim reclaim lte boundary)", () => {
    expect(isLiveOcrLease({ ...live, leaseExpiresAt: now }, "tok-live", now)).toBe(false);
  });

  it("rejects wrong token, non-running state, null lease, and job TTL expiry", () => {
    expect(isLiveOcrLease(live, "other", now)).toBe(false);
    expect(isLiveOcrLease({ ...live, state: "failed" }, "tok-live", now)).toBe(false);
    expect(isLiveOcrLease({ ...live, leaseExpiresAt: null }, "tok-live", now)).toBe(false);
    expect(
      isLiveOcrLease(
        { ...live, expiresAt: new Date("2026-10-11T17:00:00.000Z") },
        "tok-live",
        now,
      ),
    ).toBe(false);
  });
});
