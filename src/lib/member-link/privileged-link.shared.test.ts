import { describe, expect, it } from "vitest";

import {
  capTokenExpiresAt,
  PRIVILEGED_TOKEN_MAX_DAYS,
  roleReceivesPrivilegedTokenCap,
  roleRequiresAshedVerification,
  userRequiresAshedVerification,
} from "./privileged-link.shared";

describe("roleRequiresAshedVerification", () => {
  it("is false for every role — invite + member link gate HQ access", () => {
    expect(roleRequiresAshedVerification("owner")).toBe(false);
    expect(roleRequiresAshedVerification("officer")).toBe(false);
    expect(roleRequiresAshedVerification("member")).toBe(false);
    expect(roleRequiresAshedVerification(null)).toBe(false);
  });
});

describe("userRequiresAshedVerification", () => {
  it("is false for platform maintainers and alliance roles", () => {
    expect(
      userRequiresAshedVerification({
        roleName: "owner",
        isPlatformMaintainer: true,
      }),
    ).toBe(false);
    expect(
      userRequiresAshedVerification({
        roleName: "officer",
        isPlatformMaintainer: false,
      }),
    ).toBe(false);
  });
});

describe("roleReceivesPrivilegedTokenCap", () => {
  it("includes owner and officer voluntary connects", () => {
    expect(roleReceivesPrivilegedTokenCap("owner")).toBe(true);
    expect(roleReceivesPrivilegedTokenCap("officer")).toBe(true);
    expect(roleReceivesPrivilegedTokenCap("member")).toBe(false);
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
