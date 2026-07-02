/** Prefix for alliance VR sandbox season keys — excluded from live leaderboards. */
export const VR_SANDBOX_SEASON_KEY_PREFIX = "sandbox:";

export function isSandboxSeasonKey(seasonKey: string): boolean {
  return seasonKey.startsWith(VR_SANDBOX_SEASON_KEY_PREFIX);
}

export function buildSandboxSeasonKey(suffix: string): string {
  return `${VR_SANDBOX_SEASON_KEY_PREFIX}${suffix}`;
}
