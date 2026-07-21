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

export function commanderStatsFromAshedSnapshot(
  ashedStats: CommanderAshedStats | null | undefined,
  primaryName: string | null,
) {
  const powerLevel = normalizePowerLevelString({
    powerLevel: ashedStats?.powerLevel,
  });
  return {
    primaryName,
    primaryNameNormalized: primaryName
      ? normalizeCommanderName(primaryName)
      : null,
    profession: ashedStats?.profession ?? null,
    professionalLevel: ashedStats?.professionalLevel ?? null,
    // Raw level from Ashed/OCR; dual-write path clamps via upsertCommanderLevel.
    // upsertCommanderRow strips this field so inbound conflict policy can run.
    memberLevel:
      typeof ashedStats?.memberLevel === "number" &&
      Number.isFinite(ashedStats.memberLevel) &&
      ashedStats.memberLevel >= 1
        ? Math.round(ashedStats.memberLevel)
        : null,
    powerLevel,
    currentKills: ashedStats?.currentKills ?? null,
    currentSquadPowerJson: ashedStats?.currentSquadPowerJson ?? null,
    currentTotalHeroPower:
      typeof ashedStats?.currentTotalHeroPower === "number" &&
      ashedStats.currentTotalHeroPower > 0
        ? Math.round(ashedStats.currentTotalHeroPower)
        : null,
  };
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
