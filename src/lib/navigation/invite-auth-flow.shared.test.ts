import { describe, expect, it } from "vitest";

import { isInviteAuthFlow } from "@/lib/navigation/invite-auth-flow.shared";

describe("isInviteAuthFlow", () => {
  it("returns true for from=invite", () => {
    expect(isInviteAuthFlow({ fromInvite: "invite" })).toBe(true);
  });

  it("returns true when callback is an invite accept path", () => {
    expect(
      isInviteAuthFlow({
        callbackUrl: "/invite/abc123?next=%2Fonboard",
      }),
    ).toBe(true);
  });

  it("returns false for unrelated callbacks", () => {
    expect(isInviteAuthFlow({ callbackUrl: "/onboard" })).toBe(false);
  });
});
