import { normalizeCommanderName } from "@/lib/members/commander-identity-conflicts.shared";
import { normalizePowerLevelString } from "@/lib/commanders/power-stats.shared";

/** Stats mirrored from an Ashed Member entity or roster video row onto a Commander. */
export type CommanderAshedStats = {
  profession?: string | null;
  professionalLevel?: number | null;
  memberLevel?: number | null;
  powerLevel?: string | null;
  currentTotalHeroPower?: number | null;
  currentKills?: number | null;
  currentSquadPowerJson?: unknown;
};

function hasAshedStatKey(
  ashedStats: CommanderAshedStats | null | undefined,
  key: keyof CommanderAshedStats,
): boolean {
  return ashedStats != null && Object.hasOwn(ashedStats, key);
}

export function commanderStatsFromAshedSnapshot(
  ashedStats: CommanderAshedStats | null | undefined,
  primaryName: string | null,
) {
  const snapshot: {
    primaryName: string | null;
    primaryNameNormalized: string | null;
    profession?: string | null;
    professionalLevel?: number | null;
    memberLevel?: number | null;
    powerLevel?: string | null;
    currentKills?: number | null;
    currentSquadPowerJson?: unknown;
    currentTotalHeroPower?: number | null;
  } = {
    primaryName,
    primaryNameNormalized: primaryName
      ? normalizeCommanderName(primaryName)
      : null,
  };

  if (hasAshedStatKey(ashedStats, "profession")) {
    snapshot.profession = ashedStats?.profession ?? null;
  }
  if (hasAshedStatKey(ashedStats, "professionalLevel")) {
    snapshot.professionalLevel = ashedStats?.professionalLevel ?? null;
  }
  if (hasAshedStatKey(ashedStats, "memberLevel")) {
    snapshot.memberLevel =
      typeof ashedStats?.memberLevel === "number" &&
      Number.isFinite(ashedStats.memberLevel) &&
      ashedStats.memberLevel >= 1
        ? Math.round(ashedStats.memberLevel)
        : null;
  }
  if (hasAshedStatKey(ashedStats, "powerLevel")) {
    snapshot.powerLevel = normalizePowerLevelString({
      powerLevel: ashedStats?.powerLevel,
    });
  }
  if (hasAshedStatKey(ashedStats, "currentKills")) {
    snapshot.currentKills = ashedStats?.currentKills ?? null;
  }
  if (hasAshedStatKey(ashedStats, "currentSquadPowerJson")) {
    snapshot.currentSquadPowerJson = ashedStats?.currentSquadPowerJson ?? null;
  }
  if (hasAshedStatKey(ashedStats, "currentTotalHeroPower")) {
    snapshot.currentTotalHeroPower =
      typeof ashedStats?.currentTotalHeroPower === "number" &&
      ashedStats.currentTotalHeroPower > 0
        ? Math.round(ashedStats.currentTotalHeroPower)
        : null;
  }

  return snapshot;
}

export function ashedMemberRecordToCommanderStats(record: {
  profession?: string | null;
  professional_level?: number | null;
  level?: number | null;
  power_level?: string | null;
  current_total_hero_power?: number | null;
  current_kills?: number | null;
  current_squad_power?: unknown;
}): CommanderAshedStats {
  return {
    profession: record.profession?.toString() ?? null,
    professionalLevel:
      typeof record.professional_level === "number"
        ? record.professional_level
        : null,
    memberLevel:
      typeof record.level === "number" && Number.isFinite(record.level)
        ? Math.round(record.level)
        : null,
    powerLevel: record.power_level ?? null,
    currentTotalHeroPower:
      typeof record.current_total_hero_power === "number"
        ? record.current_total_hero_power
        : null,
    currentKills:
      typeof record.current_kills === "number" ? record.current_kills : null,
    currentSquadPowerJson: record.current_squad_power ?? null,
  };
}
