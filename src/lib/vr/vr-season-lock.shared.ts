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
  /** Practice mode — writes use an isolated sandbox key, not the live leaderboard. */
  vrSandboxActive: boolean;
};

export function resolveVrSeasonContextFromParts(input: {
  envSeasonKey: string | null | undefined;
  effective: { seasonKey: string; isPostSeason: boolean };
  sandbox: { enabled: boolean; seasonKey: string | null };
}): VrSeasonContext {
  const envKey = input.envSeasonKey?.trim();
  if (envKey) {
    return {
      seasonKey: envKey,
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: false,
    };
  }

  if (input.sandbox.enabled && input.sandbox.seasonKey?.trim()) {
    return {
      seasonKey: input.sandbox.seasonKey.trim(),
      isPostSeason: false,
      vrUpdatesLocked: false,
      priorSeason: null,
      vrSandboxActive: true,
    };
  }

  const vrUpdatesLocked = input.effective.isPostSeason;
  return {
    seasonKey: input.effective.seasonKey,
    isPostSeason: input.effective.isPostSeason,
    vrUpdatesLocked,
    priorSeason: vrUpdatesLocked ? input.effective.seasonKey : null,
    vrSandboxActive: false,
  };
}

export function withVrSandboxDiscordNotice(
  reply: string,
  vrSandboxActive: boolean,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!vrSandboxActive) {
    return reply;
  }
  return `${translate("vr.sandboxActive")}\n\n${reply}`;
}
