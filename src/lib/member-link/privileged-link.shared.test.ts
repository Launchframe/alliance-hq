import { describe, expect, it } from "vitest";

import {
  capTokenExpiresAtAtSession,
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

describe("capTokenExpiresAtAtSession", () => {
  const sessionExpiresAt = new Date("2026-09-01T00:00:00.000Z");

  it("returns jwt exp when it is before session expiry", () => {
    const jwtExp = new Date("2026-06-15T00:00:00.000Z");
    expect(
      capTokenExpiresAtAtSession(jwtExp, sessionExpiresAt)?.toISOString(),
    ).toBe(jwtExp.toISOString());
  });

  it("clamps jwt exp to browser session expiresAt", () => {
    const jwtExp = new Date("2026-12-01T00:00:00.000Z");
    expect(
      capTokenExpiresAtAtSession(jwtExp, sessionExpiresAt)?.toISOString(),
    ).toBe(sessionExpiresAt.toISOString());
  });

  it("returns jwt exp when session expiry is unknown", () => {
    const jwtExp = new Date("2026-12-01T00:00:00.000Z");
    expect(capTokenExpiresAtAtSession(jwtExp, null)?.toISOString()).toBe(
      jwtExp.toISOString(),
    );
  });

  it("returns null for null jwt exp", () => {
    expect(capTokenExpiresAtAtSession(null, sessionExpiresAt)).toBeNull();
  });
});
