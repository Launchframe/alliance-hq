/** Slash commands that bind an in-game commander inside a registered guild alliance. */
export const DISCORD_COMMANDER_LINK_COMMANDS = [
  "link-commander",
  "link-last-war-profile",
] as const;

export type DiscordCommanderLinkCommand =
  (typeof DISCORD_COMMANDER_LINK_COMMANDS)[number];

export function isDiscordCommanderLinkCommand(
  commandName: string | undefined,
): commandName is DiscordCommanderLinkCommand {
  return (
    commandName != null &&
    (DISCORD_COMMANDER_LINK_COMMANDS as readonly string[]).includes(commandName)
  );
}

/** Slash commands that report or confirm institute / base VR. */
export const DISCORD_VR_SLASH_COMMANDS = ["vr", "immunity", "institute"] as const;

export function isDiscordVrSlashCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName != null &&
    (DISCORD_VR_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}

/** Slash commands that set Discord bot reply locale. */
export const DISCORD_LANGUAGE_SLASH_COMMANDS = [
  "language",
  "linguagem",
] as const;

export function isDiscordLanguageSlashCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName != null &&
    (DISCORD_LANGUAGE_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}
