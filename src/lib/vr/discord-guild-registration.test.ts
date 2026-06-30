import { describe, expect, it } from "vitest";

import {
  evaluateGuildRegistrationAuth,
  type GuildRegistrationAuth,
  nativeOwnerClaimMemberId,
  officerProvenByMemberRanks,
  ownerProvenByMemberLink,
} from "@/lib/vr/discord-guild-registration";

function auth(
  overrides: Partial<Parameters<typeof evaluateGuildRegistrationAuth>[0]>,
): GuildRegistrationAuth {
  return evaluateGuildRegistrationAuth({
    hasHqLink: true,
    isPlatformMaintainer: false,
    isCredentialRegistrant: false,
    isOwnerViaMemberLink: false,
    isOfficerViaMemberLink: false,
    ownerAshedUserId: "owner-1",
    linkedHqAshedUserId: "owner-1",
    hasCredentials: true,
    ...overrides,
  });
}

describe("evaluateGuildRegistrationAuth", () => {
  it("denies legacy Ashed owner path when Discord user has no HQ link", () => {
    expect(auth({ hasHqLink: false })).toEqual({
      allowed: false,
      reason: "no_hq_link",
    });
  });

  it("allows owner via member link without HQ link", () => {
    expect(
      auth({
        hasHqLink: false,
        isOwnerViaMemberLink: true,
        linkedHqAshedUserId: null,
      }),
    ).toEqual({ allowed: true, registeredBy: "alliance_owner" });
  });

  it("allows R4+ officer via member link without owner proof", () => {
    expect(
      auth({
        isOfficerViaMemberLink: true,
        linkedHqAshedUserId: "member-9",
      }),
    ).toEqual({ allowed: true, registeredBy: "alliance_officer" });
  });

  it("allows officer via member link without HQ link (Discord-only setup)", () => {
    expect(
      auth({
        hasHqLink: false,
        isOfficerViaMemberLink: true,
        linkedHqAshedUserId: null,
      }),
    ).toEqual({ allowed: true, registeredBy: "alliance_officer" });
  });

  it("prefers owner over officer when both flags are set", () => {
    expect(
      auth({
        isOwnerViaMemberLink: true,
        isOfficerViaMemberLink: true,
      }),
    ).toEqual({ allowed: true, registeredBy: "alliance_owner" });
  });

  it("allows platform maintainers without alliance credentials", () => {
    expect(
      auth({
        isPlatformMaintainer: true,
        hasCredentials: false,
        linkedHqAshedUserId: null,
      }),
    ).toEqual({ allowed: true, registeredBy: "platform_maintainer" });
  });

  it("denies non-maintainers without credentials", () => {
    expect(auth({ hasCredentials: false })).toEqual({
      allowed: false,
      reason: "no_credentials",
    });
  });

  it("allows credential registrant", () => {
    expect(
      auth({
        isCredentialRegistrant: true,
        linkedHqAshedUserId: "someone-else",
      }),
    ).toEqual({ allowed: true, registeredBy: "credential_registrant" });
  });

  it("allows HQ user whose Ashed id matches alliance owner", () => {
    expect(
      auth({
        ownerAshedUserId: "owner-1",
        linkedHqAshedUserId: "owner-1",
      }),
    ).toEqual({ allowed: true, registeredBy: "alliance_owner" });
  });

  it("denies when owner proof fails", () => {
    expect(
      auth({
        ownerAshedUserId: "owner-1",
        linkedHqAshedUserId: "member-9",
      }),
    ).toEqual({ allowed: false, reason: "not_owner" });
  });
});

describe("officerProvenByMemberRanks", () => {
  it("returns true for R4 or R5 linked ranks", () => {
    expect(officerProvenByMemberRanks([3, 4])).toBe(true);
    expect(officerProvenByMemberRanks([5])).toBe(true);
  });

  it("returns false when no linked rank is R4+", () => {
    expect(officerProvenByMemberRanks([1, 2, 3])).toBe(false);
    expect(officerProvenByMemberRanks([])).toBe(false);
  });
});

describe("ownerProvenByMemberLink", () => {
  it("proves an owner whose member link matches ownerMemberExternalId (no Ashed)", () => {
    expect(
      ownerProvenByMemberLink({
        allianceExists: true,
        ownerMemberExternalId: "owner-member-1",
        linkedMemberIds: ["other-member", "owner-member-1"],
      }),
    ).toBe(true);
  });

  it("denies when no linked member matches the owner", () => {
    expect(
      ownerProvenByMemberLink({
        allianceExists: true,
        ownerMemberExternalId: "owner-member-1",
        linkedMemberIds: ["member-2", "member-3"],
      }),
    ).toBe(false);
  });

  it("denies when the alliance has no owner member id", () => {
    expect(
      ownerProvenByMemberLink({
        allianceExists: true,
        ownerMemberExternalId: null,
        linkedMemberIds: ["member-2"],
      }),
    ).toBe(false);
  });

  it("denies when the alliance does not exist", () => {
    expect(
      ownerProvenByMemberLink({
        allianceExists: false,
        ownerMemberExternalId: "owner-member-1",
        linkedMemberIds: ["owner-member-1"],
      }),
    ).toBe(false);
  });
});

describe("nativeOwnerClaimMemberId", () => {
  it("claims the sole active R5 in a native alliance with no owner set", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: true,
        ownerAlreadySet: false,
        linkedAshedMemberId: "member-1",
        activeR5MemberIds: ["member-1"],
      }),
    ).toBe("member-1");
  });

  it("does not claim for Ashed-sourced alliances", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: false,
        ownerAlreadySet: false,
        linkedAshedMemberId: "member-1",
        activeR5MemberIds: ["member-1"],
      }),
    ).toBeNull();
  });

  it("does not claim when an owner is already recorded", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: true,
        ownerAlreadySet: true,
        linkedAshedMemberId: "member-1",
        activeR5MemberIds: ["member-1"],
      }),
    ).toBeNull();
  });

  it("does not claim when the R5 set is ambiguous (multiple R5s)", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: true,
        ownerAlreadySet: false,
        linkedAshedMemberId: "member-1",
        activeR5MemberIds: ["member-1", "member-2"],
      }),
    ).toBeNull();
  });

  it("does not claim when there are no active R5 members", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: true,
        ownerAlreadySet: false,
        linkedAshedMemberId: "member-1",
        activeR5MemberIds: [],
      }),
    ).toBeNull();
  });

  it("does not claim when the linked member is not the sole R5", () => {
    expect(
      nativeOwnerClaimMemberId({
        isNative: true,
        ownerAlreadySet: false,
        linkedAshedMemberId: "member-9",
        activeR5MemberIds: ["member-1"],
      }),
    ).toBeNull();
  });
});
