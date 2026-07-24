export const TIME_OFF_SLASH_COMMANDS = ["my-time-off", "is-ally-offline"] as const;

export function isDiscordTimeOffSlashCommand(commandName: string): boolean {
  return (TIME_OFF_SLASH_COMMANDS as readonly string[]).includes(commandName);
}
