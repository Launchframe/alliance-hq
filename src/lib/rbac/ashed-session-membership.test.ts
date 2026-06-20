import { describe, expect, it } from "vitest";

import { ashedSourcedMembershipIsActiveForSession } from "@/lib/rbac/ashed-session-membership";

describe("ashedSourcedMembershipIsActiveForSession", () => {
  it("always allows manual memberships", () => {
    expect(ashedSourcedMembershipIsActiveForSession("manual", false)).toBe(true);
  });

  it("requires an active Ashed credential for ashed-sourced memberships", () => {
    expect(ashedSourcedMembershipIsActiveForSession("ashed", false)).toBe(false);
    expect(ashedSourcedMembershipIsActiveForSession("ashed", true)).toBe(true);
  });
});
