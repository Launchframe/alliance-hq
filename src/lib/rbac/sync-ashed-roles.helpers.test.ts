import { describe, expect, it } from "vitest";

import {
  buildAllianceRosterEmails,
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
