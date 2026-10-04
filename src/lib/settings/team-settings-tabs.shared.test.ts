import { describe, expect, it } from "vitest";

import {
  resolveTeamSettingsTab,
  teamSettingsHref,
} from "@/lib/settings/team-settings-tabs.shared";

describe("resolveTeamSettingsTab", () => {
  it("defaults to members even when can manage invites", () => {
    expect(
      resolveTeamSettingsTab(null, {
        canManageInvites: true,
        isAllianceAdmin: true,
      }),
    ).toBe("members");
  });

  it("opens invites for invite-wizard deep links without a tab", () => {
    expect(
      resolveTeamSettingsTab(null, {
        canManageInvites: true,
        isAllianceAdmin: false,
        hasInviteWizard: true,
      }),
    ).toBe("invites");
  });

  it("falls back to members for invite-wizard links when invites unauthorized", () => {
    expect(
      resolveTeamSettingsTab(null, {
        canManageInvites: false,
        isAllianceAdmin: false,
        hasInviteWizard: true,
      }),
    ).toBe("members");
  });

  it("honors an explicit invites tab", () => {
    expect(
      resolveTeamSettingsTab("invites", {
        canManageInvites: true,
        isAllianceAdmin: false,
      }),
    ).toBe("invites");
  });

  it("falls back from processors when not alliance admin", () => {
    expect(
      resolveTeamSettingsTab("processors", {
        canManageInvites: true,
        isAllianceAdmin: false,
      }),
    ).toBe("invites");
  });

  it("falls back to members when invites unauthorized", () => {
    expect(
      resolveTeamSettingsTab("invites", {
        canManageInvites: false,
        isAllianceAdmin: false,
      }),
    ).toBe("members");
  });

  it("accepts credential-shares", () => {
    expect(
      resolveTeamSettingsTab("credential-shares", {
        canManageInvites: false,
        isAllianceAdmin: false,
      }),
    ).toBe("credential-shares");
  });

  it("maps unknown tabs to members", () => {
    expect(
      resolveTeamSettingsTab("nope", {
        canManageInvites: true,
        isAllianceAdmin: true,
      }),
    ).toBe("members");
  });
});

describe("teamSettingsHref", () => {
  it("builds query deep link", () => {
    expect(teamSettingsHref("credential-shares")).toBe(
      "/settings/team?tab=credential-shares",
    );
  });
});
