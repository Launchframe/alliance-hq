/** Slash commands that report total kills. */
export const DISCORD_KILLS_SLASH_COMMANDS = ["kills"] as const;

export function isDiscordKillsSlashCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName != null &&
    (DISCORD_KILLS_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}
