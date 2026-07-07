import { describe, expect, it } from "vitest";

import {
  canCreateRosterMemberDuringOnboarding,
  isSelfServiceOnboardingEnabled,
  isSelfServiceServerEligible,
  parseInviteOnboardingMinRole,
} from "@/lib/member-link/self-service-onboarding.shared";
import {
  canManageInvitesAndOnboarding,
  canReviewMemberLinks,
  isAllianceOwnerForAccess,
} from "@/lib/member-link/invite-onboarding-access.server";
import type { RbacContext } from "@/lib/rbac/context";

function mockCtx(overrides: Partial<RbacContext> = {}): RbacContext {
  return {
    hqUserId: "hq1",
    roleName: "officer",
    permissions: new Set(["members:write"]),
    isPlatformMaintainer: false,
    ...overrides,
  } as RbacContext;
}

describe("self-service-onboarding.shared", () => {
  it("defaults self-service to enabled", () => {
    expect(isSelfServiceOnboardingEnabled(1)).toBe(true);
    expect(isSelfServiceOnboardingEnabled(0)).toBe(false);
  });

  it("blocks JIT roster creation at cap", () => {
    expect(canCreateRosterMemberDuringOnboarding(199)).toBe(true);
    expect(canCreateRosterMemberDuringOnboarding(200)).toBe(false);
  });

  it("parses invite onboarding min role", () => {
    expect(parseInviteOnboardingMinRole("owner")).toBe("owner");
    expect(parseInviteOnboardingMinRole("officer")).toBe("officer");
    expect(parseInviteOnboardingMinRole(null)).toBe("officer");
  });

  it("requires self-service members to match the alliance state server", () => {
    expect(
      isSelfServiceServerEligible({
        playerServerNumber: 1203,
        allianceServerNumber: 1203,
      }),
    ).toBe(true);
    expect(
      isSelfServiceServerEligible({
        playerServerNumber: 1205,
        allianceServerNumber: 1203,
      }),
    ).toBe(false);
    expect(
      isSelfServiceServerEligible({
        playerServerNumber: null,
        allianceServerNumber: 1203,
      }),
    ).toBe(false);
    expect(
      isSelfServiceServerEligible({
        playerServerNumber: 1203,
        allianceServerNumber: null,
      }),
    ).toBe(false);
  });
});

describe("invite-onboarding-access.server", () => {
  const alliance = {
    ownerHqUserId: "owner1",
    inviteOnboardingMinRole: "officer",
  };

  it("allows officers to review links by default", () => {
    expect(canReviewMemberLinks(mockCtx(), alliance)).toBe(true);
  });

  it("restricts review to owner when configured", () => {
    const ownerOnly = { ...alliance, inviteOnboardingMinRole: "owner" };
    expect(canReviewMemberLinks(mockCtx(), ownerOnly)).toBe(false);
    expect(
      canReviewMemberLinks(
        mockCtx({ hqUserId: "owner1", roleName: "owner" }),
        ownerOnly,
      ),
    ).toBe(true);
    expect(isAllianceOwnerForAccess(mockCtx({ hqUserId: "owner1" }), ownerOnly)).toBe(
      true,
    );
  });

  it("allows platform maintainer to manage invites regardless", () => {
    const ownerOnly = { ...alliance, inviteOnboardingMinRole: "owner" };
    expect(
      canManageInvitesAndOnboarding(
        mockCtx({ isPlatformMaintainer: true, roleName: "member", permissions: new Set() }),
        ownerOnly,
      ),
    ).toBe(true);
  });
});
