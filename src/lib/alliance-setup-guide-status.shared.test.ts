import { describe, expect, it } from "vitest";

import {
  allianceSetupGuideProgress,
  commanderLinkTaskComplete,
  computeAllianceSetupGuideTasks,
  resolveOwnerHasCommanderLink,
  taskIdsForOperatingMode,
} from "@/lib/alliance-setup-guide-status.shared";

const baseSignals = {
  operatingMode: "ashed" as const,
  gameServerLinked: true,
  ownerHasCommanderLink: false,
  viewerHasCommanderLink: false,
  hasTeamInvite: true,
  discordGuildRegistered: false,
  ashedConnected: true,
  rosterHardeningComplete: false,
  rosterPopulated: true,
};

describe("alliance setup guide", () => {
  it("shows ashed officer tasks for ashed alliances", () => {
    const ids = taskIdsForOperatingMode("ashed", true);
    expect(ids).toContain("connect_ashed");
    expect(ids).toContain("roster_hardening");
    expect(ids).not.toContain("roster_populated");
  });

  it("shows native roster task for native alliances", () => {
    const ids = taskIdsForOperatingMode("native", true);
    expect(ids).toContain("roster_populated");
    expect(ids).not.toContain("roster_hardening");
  });

  it("limits non-officer viewers to commander link task", () => {
    const ids = taskIdsForOperatingMode("ashed", false);
    expect(ids).toEqual(["owner_commander_link"]);
  });

  it("marks completion from signals", () => {
    const tasks = computeAllianceSetupGuideTasks({
      ...baseSignals,
      viewerIsOfficer: true,
    });

    const byId = Object.fromEntries(tasks.map((task) => [task.id, task.complete]));
    expect(byId.game_server).toBe(true);
    expect(byId.team_invites).toBe(true);
    expect(byId.connect_ashed).toBe(true);
    expect(byId.roster_hardening).toBe(false);
    expect(allianceSetupGuideProgress(tasks).allComplete).toBe(false);
  });

  it("uses viewer link for non-officer commander task", () => {
    expect(
      commanderLinkTaskComplete({
        ...baseSignals,
        ownerHasCommanderLink: false,
        viewerHasCommanderLink: true,
        viewerIsOfficer: false,
      }),
    ).toBe(true);
  });

  it("uses owner link for officer commander task", () => {
    expect(
      commanderLinkTaskComplete({
        ...baseSignals,
        ownerHasCommanderLink: true,
        viewerHasCommanderLink: false,
        viewerIsOfficer: true,
      }),
    ).toBe(true);
  });

  it("counts the officer's own commander link even when owner link is missing", () => {
    expect(
      commanderLinkTaskComplete({
        ...baseSignals,
        ownerHasCommanderLink: false,
        viewerHasCommanderLink: true,
        viewerIsOfficer: true,
      }),
    ).toBe(true);
  });

  it("counts cold-start owner link when ownerHqUserId is unset", () => {
    expect(
      resolveOwnerHasCommanderLink({
        ownerHqUserId: null,
        ownerUserHasLink: false,
        viewerHqUserId: "viewer-1",
        viewerHasCommanderLink: true,
        viewerRoleName: "owner",
      }),
    ).toBe(true);
  });

  it("reuses viewer link when viewer is stamped owner", () => {
    expect(
      resolveOwnerHasCommanderLink({
        ownerHqUserId: "viewer-1",
        ownerUserHasLink: false,
        viewerHqUserId: "viewer-1",
        viewerHasCommanderLink: true,
        viewerRoleName: "owner",
      }),
    ).toBe(true);
  });
});
