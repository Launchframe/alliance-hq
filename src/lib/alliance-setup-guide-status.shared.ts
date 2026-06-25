import type { AllianceOperatingMode } from "@/lib/native-alliance/constants";

export const ALLIANCE_SETUP_GUIDE_SHARED_TASK_IDS = [
  "game_server",
  "owner_commander_link",
  "team_invites",
  "discord_guild",
] as const;

export const ALLIANCE_SETUP_GUIDE_ASHED_TASK_IDS = [
  "connect_ashed",
  "roster_hardening",
] as const;

export const ALLIANCE_SETUP_GUIDE_NATIVE_TASK_IDS = [
  "roster_populated",
] as const;

export const ALLIANCE_SETUP_GUIDE_TASK_IDS = [
  ...ALLIANCE_SETUP_GUIDE_SHARED_TASK_IDS,
  ...ALLIANCE_SETUP_GUIDE_ASHED_TASK_IDS,
  ...ALLIANCE_SETUP_GUIDE_NATIVE_TASK_IDS,
] as const;

export type AllianceSetupGuideTaskId =
  (typeof ALLIANCE_SETUP_GUIDE_TASK_IDS)[number];

export type AllianceSetupGuideTaskStatus = {
  id: AllianceSetupGuideTaskId;
  complete: boolean;
  /** Officer-only tasks hidden from plain members */
  officerOnly?: boolean;
};

export type AllianceSetupGuideSignals = {
  operatingMode: AllianceOperatingMode;
  gameServerLinked: boolean;
  ownerHasCommanderLink: boolean;
  hasTeamInvite: boolean;
  discordGuildRegistered: boolean;
  ashedConnected: boolean;
  rosterHardeningComplete: boolean;
  rosterPopulated: boolean;
  viewerIsOfficer: boolean;
};

export function taskIdsForOperatingMode(
  mode: AllianceOperatingMode,
  viewerIsOfficer: boolean,
): AllianceSetupGuideTaskId[] {
  const shared = [...ALLIANCE_SETUP_GUIDE_SHARED_TASK_IDS];
  const modeSpecific =
    mode === "native"
      ? [...ALLIANCE_SETUP_GUIDE_NATIVE_TASK_IDS]
      : [...ALLIANCE_SETUP_GUIDE_ASHED_TASK_IDS];

  const ids = [...modeSpecific, ...shared];
  if (!viewerIsOfficer) {
    return ids.filter((id) => id === "owner_commander_link");
  }
  return ids;
}

export function computeAllianceSetupGuideTasks(
  signals: AllianceSetupGuideSignals,
): AllianceSetupGuideTaskStatus[] {
  const ids = taskIdsForOperatingMode(
    signals.operatingMode,
    signals.viewerIsOfficer,
  );

  const completion: Record<AllianceSetupGuideTaskId, boolean> = {
    connect_ashed: signals.ashedConnected,
    roster_hardening: signals.rosterHardeningComplete,
    roster_populated: signals.rosterPopulated,
    game_server: signals.gameServerLinked,
    owner_commander_link: signals.ownerHasCommanderLink,
    team_invites: signals.hasTeamInvite,
    discord_guild: signals.discordGuildRegistered,
  };

  const officerOnly = new Set<AllianceSetupGuideTaskId>([
    "connect_ashed",
    "roster_hardening",
    "roster_populated",
    "game_server",
    "team_invites",
    "discord_guild",
  ]);

  return ids.map((id) => ({
    id,
    complete: completion[id],
    officerOnly: officerOnly.has(id),
  }));
}

export function allianceSetupGuideProgress(
  tasks: readonly AllianceSetupGuideTaskStatus[],
): {
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
} {
  const totalCount = tasks.length;
  const completedCount = tasks.filter((task) => task.complete).length;
  return {
    completedCount,
    totalCount,
    allComplete: totalCount > 0 && completedCount === totalCount,
  };
}
