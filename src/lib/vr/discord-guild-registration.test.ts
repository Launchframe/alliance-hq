import { describe, expect, it } from "vitest";

import {
  evaluateGuildRegistrationAuth,
  type GuildRegistrationAuth,
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
