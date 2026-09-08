import { describe, expect, it } from "vitest";

import {
  resolveTeamSettingsTab,
  teamSettingsHref,
} from "@/lib/settings/team-settings-tabs.shared";

describe("resolveTeamSettingsTab", () => {
  it("defaults to invites when can manage invites", () => {
    expect(
      resolveTeamSettingsTab(null, {
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

  it("maps unknown tabs to invites when allowed", () => {
    expect(
      resolveTeamSettingsTab("nope", {
        canManageInvites: true,
        isAllianceAdmin: true,
      }),
    ).toBe("invites");
  });
});

describe("teamSettingsHref", () => {
  it("builds query deep link", () => {
    expect(teamSettingsHref("credential-shares")).toBe(
      "/settings/team?tab=credential-shares",
    );
  });
});
