import { describe, expect, it } from "vitest";

import {
  evaluateGuildRegistrationAuth,
  type GuildRegistrationAuth,
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
