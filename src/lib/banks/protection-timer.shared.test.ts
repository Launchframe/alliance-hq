import { describe, expect, it } from "vitest";

import {
  computeProtectionExpiresAt,
  nextProtectionResetAt,
  resolveProtectionExpiresAt,
} from "@/lib/banks/protection-timer.shared";

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

  it("resolveProtectionExpiresAt returns null without safe time slot", () => {
    expect(
      resolveProtectionExpiresAt({
        explicit: null,
        capturedAt: new Date("2026-07-27T10:00:00.000-02:00"),
        safeTimeSlot: null,
      }),
    ).toBeNull();
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
