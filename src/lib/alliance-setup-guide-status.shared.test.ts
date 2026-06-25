import { describe, expect, it } from "vitest";

import {
  allianceSetupGuideProgress,
  computeAllianceSetupGuideTasks,
  taskIdsForOperatingMode,
} from "@/lib/alliance-setup-guide-status.shared";

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
      operatingMode: "ashed",
      gameServerLinked: true,
      ownerHasCommanderLink: false,
      hasTeamInvite: true,
      discordGuildRegistered: false,
      ashedConnected: true,
      rosterHardeningComplete: false,
      rosterPopulated: true,
      viewerIsOfficer: true,
    });

    const byId = Object.fromEntries(tasks.map((task) => [task.id, task.complete]));
    expect(byId.game_server).toBe(true);
    expect(byId.team_invites).toBe(true);
    expect(byId.connect_ashed).toBe(true);
    expect(byId.roster_hardening).toBe(false);
    expect(allianceSetupGuideProgress(tasks).allComplete).toBe(false);
  });
});
