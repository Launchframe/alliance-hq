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
