import { describe, expect, it } from "vitest";

import {
  capTokenExpiresAt,
  PRIVILEGED_TOKEN_MAX_DAYS,
  roleRequiresAshedVerification,
  userRequiresAshedVerification,
} from "./privileged-link.shared";

describe("roleRequiresAshedVerification", () => {
  it("requires owner and officer only", () => {
    expect(roleRequiresAshedVerification("owner")).toBe(true);
    expect(roleRequiresAshedVerification("officer")).toBe(true);
    expect(roleRequiresAshedVerification("member")).toBe(false);
    expect(roleRequiresAshedVerification("data_entry")).toBe(false);
    expect(roleRequiresAshedVerification(null)).toBe(false);
  });
});

describe("userRequiresAshedVerification", () => {
  it("includes platform maintainers", () => {
    expect(
      userRequiresAshedVerification({
        roleName: "member",
        isPlatformMaintainer: true,
      }),
    ).toBe(true);
  });
});

describe("capTokenExpiresAt", () => {
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("returns jwt exp when within the cap window", () => {
    const jwtExp = new Date("2026-06-15T00:00:00.000Z");
    expect(capTokenExpiresAt(jwtExp, now)?.toISOString()).toBe(
      jwtExp.toISOString(),
    );
  });

  it("clamps jwt exp to now + 30 days", () => {
    const jwtExp = new Date("2026-12-01T00:00:00.000Z");
    const capped = capTokenExpiresAt(jwtExp, now);
    expect(capped).not.toBeNull();
    const expected = new Date(now);
    expected.setUTCDate(expected.getUTCDate() + PRIVILEGED_TOKEN_MAX_DAYS);
    expect(capped?.toISOString()).toBe(expected.toISOString());
  });

  it("returns null for null jwt exp", () => {
    expect(capTokenExpiresAt(null, now)).toBeNull();
  });
});
