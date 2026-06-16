export type SeasonKeySource =
  | "override"
  | "cpt-hedge"
  | "age-fallback"
  | "default";

export type CptHedgeServerRecord = {
  id: string;
  timestampMs: number;
  currentSeason: number;
  isPostSeason: boolean;
  currentWeek: number | null;
};

export type AllianceSeasonRow = {
  id: string;
  currentSeasonKey: string | null;
  gameServerNumber: number | null;
  gameServerOpenTimestamp: number | null;
  seasonKeyOverride: string | null;
  seasonKeySynced: string | null;
  seasonKeySource: string | null;
  seasonSyncedAt: Date | null;
  seasonIsPostSeason: number;
  seasonWeek: number | null;
};

export type EffectiveSeason = {
  seasonKey: string;
  source: SeasonKeySource;
  isPostSeason: boolean;
  week: number | null;
  gameServerNumber: number | null;
};
