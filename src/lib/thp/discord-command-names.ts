/** Slash commands that report total hero power. */
export const DISCORD_THP_SLASH_COMMANDS = ["thp", "hero-power"] as const;

export function isDiscordThpSlashCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName != null &&
    (DISCORD_THP_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}
