import { seasonKeyFromAge } from "@/lib/game-season/age";
import type { CptHedgeServerRecord } from "@/lib/game-season/types";
import type {
  AllianceSeasonRow,
  EffectiveSeason,
  SeasonKeySource,
} from "@/lib/game-season/types";

export function normalizeSeasonKey(value: string | number | null | undefined): string {
  if (value == null) return "1";
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : "1";
}

export function resolveEffectiveSeasonFromRow(
  row: AllianceSeasonRow,
): EffectiveSeason {
  const override = row.seasonKeyOverride?.trim();
  if (override) {
    return {
      seasonKey: normalizeSeasonKey(override),
      source: "override",
      isPostSeason: row.seasonIsPostSeason === 1,
      week: row.seasonWeek,
      gameServerNumber: row.gameServerNumber,
    };
  }

  const synced = row.seasonKeySynced?.trim() ?? row.currentSeasonKey?.trim();
  const source = (row.seasonKeySource?.trim() as SeasonKeySource | undefined) ?? "default";

  if (synced) {
    return {
      seasonKey: normalizeSeasonKey(synced),
      source: source === "override" ? "default" : source,
      isPostSeason: row.seasonIsPostSeason === 1,
      week: row.seasonWeek,
      gameServerNumber: row.gameServerNumber,
    };
  }

  return {
    seasonKey: "1",
    source: "default",
    isPostSeason: false,
    week: null,
    gameServerNumber: row.gameServerNumber,
  };
}

export function resolveSeasonFromCptHedgeRecord(
  record: CptHedgeServerRecord,
): Pick<
  EffectiveSeason,
  "seasonKey" | "source" | "isPostSeason" | "week"
> & { openTimestampMs: number } {
  return {
    seasonKey: String(record.currentSeason),
    source: "cpt-hedge",
    isPostSeason: record.isPostSeason,
    week: record.currentWeek,
    openTimestampMs: record.timestampMs,
  };
}

export function resolveSeasonFromAgeFallback(
  openTimestampMs: number,
  now = new Date(),
): Pick<EffectiveSeason, "seasonKey" | "source"> {
  return {
    seasonKey: seasonKeyFromAge(openTimestampMs, now),
    source: "age-fallback",
  };
}
