import { describe, expect, it } from "vitest";

import {
  allianceTagsMatchForShellAdoption,
  buildAllianceRosterEmails,
  isUnlinkedHqAllianceShell,
  shouldRevokeAshedMembership,
} from "@/lib/rbac/sync-ashed-roles.helpers";

describe("buildAllianceRosterEmails", () => {
  it("includes normalized owner and collaborators", () => {
    const roster = buildAllianceRosterEmails({
      owner_email: " Owner@Example.com ",
      collaborators: ["  HubSub.LLC@gmail.com", "other@example.com"],
    });

    expect([...roster].sort()).toEqual([
      "hubsub.llc@gmail.com",
      "other@example.com",
      "owner@example.com",
    ]);
  });

  it("returns empty set when roster fields are missing", () => {
    expect(buildAllianceRosterEmails({}).size).toBe(0);
  });
});

describe("shouldRevokeAshedMembership", () => {
  const roster = buildAllianceRosterEmails({
    owner_email: "owner@example.com",
    collaborators: ["maintainer@example.com"],
  });

  it("revokes ashed memberships for emails no longer on the roster", () => {
    expect(
      shouldRevokeAshedMembership("removed@example.com", roster, "ashed"),
    ).toBe(true);
  });

  it("keeps ashed memberships for roster emails", () => {
    expect(
      shouldRevokeAshedMembership("maintainer@example.com", roster, "ashed"),
    ).toBe(false);
  });

  it("never revokes manual memberships", () => {
    expect(
      shouldRevokeAshedMembership("removed@example.com", roster, "manual"),
    ).toBe(false);
  });
});

describe("isUnlinkedHqAllianceShell", () => {
  it("returns true when ashedAllianceId is null or blank", () => {
    expect(isUnlinkedHqAllianceShell({ ashedAllianceId: null })).toBe(true);
    expect(isUnlinkedHqAllianceShell({ ashedAllianceId: "  " })).toBe(true);
  });

  it("returns false when ashedAllianceId is set", () => {
    expect(
      isUnlinkedHqAllianceShell({ ashedAllianceId: "ashed-abc" }),
    ).toBe(false);
  });
});

describe("allianceTagsMatchForShellAdoption", () => {
  it("matches tags case-insensitively with surrounding whitespace", () => {
    expect(allianceTagsMatchForShellAdoption(" ROAR ", "roar")).toBe(true);
  });

  it("returns false when either tag is missing", () => {
    expect(allianceTagsMatchForShellAdoption("", "roar")).toBe(false);
    expect(allianceTagsMatchForShellAdoption("roar", "")).toBe(false);
  });
});
