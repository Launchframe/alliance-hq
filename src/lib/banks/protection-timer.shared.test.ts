import { describe, expect, it } from "vitest";

import {
  computeProtectionExpiresAt,
  nextProtectionResetAt,
  resolveProtectionExpiresAt,
} from "@/lib/banks/protection-timer.shared";
import { BANK_PROTECTION_DURATION_MS } from "@/lib/banks/types.shared";

describe("protection-timer.shared", () => {
  it("finds next Wednesday 12:00 after Monday capture", () => {
    const capturedAt = new Date("2026-07-27T10:00:00.000-02:00"); // Mon
    const expires = computeProtectionExpiresAt(capturedAt, "12");
    expect(expires.toISOString()).toBe("2026-07-29T14:00:00.000Z"); // Wed 12:00 UTC-2
  });

  it("finds next Saturday 20:00 when Wednesday already passed", () => {
    const after = new Date("2026-07-29T21:00:00.000-02:00"); // Wed after 20:00 slot
    const expires = nextProtectionResetAt(after, "20");
    expect(expires.toISOString()).toBe("2026-08-01T22:00:00.000Z"); // Sat 20:00 UTC-2
  });

  it("uses same-day reset when capture is before slot on reset day", () => {
    const capturedAt = new Date("2026-07-29T08:00:00.000-02:00"); // Wed morning
    const expires = computeProtectionExpiresAt(capturedAt, "12");
    expect(expires.toISOString()).toBe("2026-07-29T14:00:00.000Z");
  });

  it("resolveProtectionExpiresAt returns null without a capture time", () => {
    expect(
      resolveProtectionExpiresAt({
        explicit: null,
        capturedAt: null,
        safeTimeSlot: null,
      }),
    ).toBeNull();
  });

  it("resolveProtectionExpiresAt falls back to the fixed duration when safe time is not configured", () => {
    // Legacy behavior for alliances that have not set Alliance Safe Time yet —
    // must keep populating protectionExpiresAt so downstream consumers (e.g.
    // Discord protection-expiry announcements) keep working.
    const capturedAt = new Date("2026-07-27T10:00:00.000-02:00");
    const expires = resolveProtectionExpiresAt({
      explicit: null,
      capturedAt,
      safeTimeSlot: null,
    });
    expect(expires?.getTime()).toBe(
      capturedAt.getTime() + BANK_PROTECTION_DURATION_MS,
    );
  });

  it("resolveProtectionExpiresAt prefers the safe-time schedule once configured", () => {
    const capturedAt = new Date("2026-07-27T10:00:00.000-02:00"); // Mon
    const expires = resolveProtectionExpiresAt({
      explicit: null,
      capturedAt,
      safeTimeSlot: "12",
    });
    expect(expires?.toISOString()).toBe("2026-07-29T14:00:00.000Z"); // Wed 12:00 UTC-2
  });

  it("resolveProtectionExpiresAt honors explicit override", () => {
    const explicit = "2026-08-15T12:00:00.000Z";
    expect(
      resolveProtectionExpiresAt({
        explicit,
        capturedAt: new Date("2026-07-27T10:00:00.000-02:00"),
        safeTimeSlot: "04",
      })?.toISOString(),
    ).toBe(explicit);
  });
});
