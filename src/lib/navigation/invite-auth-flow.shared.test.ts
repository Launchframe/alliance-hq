import { describe, expect, it } from "vitest";

import { isInviteAuthFlow } from "@/lib/navigation/invite-auth-flow.shared";

describe("isInviteAuthFlow", () => {
  it("returns true for from=invite", () => {
    expect(isInviteAuthFlow({ fromInvite: "invite" })).toBe(true);
  });

  it("returns true for trimmed from=invite", () => {
    expect(isInviteAuthFlow({ fromInvite: "  invite  " })).toBe(true);
  });

  it("returns true when callback is an invite accept path", () => {
    expect(
      isInviteAuthFlow({
        callbackUrl: "/invite/abc123?next=%2Fonboard",
      }),
    ).toBe(true);
  });

  it("returns true for locale-prefixed invite callback paths", () => {
    expect(
      isInviteAuthFlow({
        callbackUrl: "/pt-BR/invite/abc123?next=%2Fonboard",
      }),
    ).toBe(true);
  });

  it("returns true for absolute invite callback URLs", () => {
    expect(
      isInviteAuthFlow({
        callbackUrl: "https://hq.example.com/pt-BR/invite/abc123",
      }),
    ).toBe(true);
  });

  it("returns false when from and callback are absent", () => {
    expect(isInviteAuthFlow({})).toBe(false);
  });

  it("returns false for unrelated from values", () => {
    expect(isInviteAuthFlow({ fromInvite: "dashboard" })).toBe(false);
  });

  it("returns false for unrelated callbacks", () => {
    expect(isInviteAuthFlow({ callbackUrl: "/onboard" })).toBe(false);
  });

  it("returns false for malformed absolute callback URLs", () => {
    expect(
      isInviteAuthFlow({ callbackUrl: "https://[invalid" }),
    ).toBe(false);
  });
});
