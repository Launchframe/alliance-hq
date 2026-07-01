/** Shared VR season lock copy — uses discordBot.vr.seasonLocked via translate. */
export function vrSeasonLockedMessage(
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  return translate("vr.seasonLocked");
}

export type VrSeasonContext = {
  /** Season key for VR rows (the ended season while in post-season). */
  seasonKey: string;
  isPostSeason: boolean;
  /** True when the game server is in post-season — self-report VR is locked. */
  vrUpdatesLocked: boolean;
  /** Ended season referenced during post-season; null while the season is active. */
  priorSeason: string | null;
};
