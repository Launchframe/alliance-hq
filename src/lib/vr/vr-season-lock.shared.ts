/** Shared VR season lock copy — wire to i18n when locale keys are approved. */
export const VR_SEASON_LOCKED_MESSAGE =
  "The season is over. VR updates are closed until the next season starts.";

export type VrSeasonContext = {
  /** Season key for VR rows (the ended season while in post-season). */
  seasonKey: string;
  isPostSeason: boolean;
  /** True when the game server is in post-season — self-report VR is locked. */
  vrUpdatesLocked: boolean;
  /** Ended season referenced during post-season; null while the season is active. */
  priorSeason: string | null;
};
