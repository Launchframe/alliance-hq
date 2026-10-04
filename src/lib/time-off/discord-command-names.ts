export const TIME_OFF_SLASH_COMMANDS = ["my-time-off", "set-time-off", "cancel-time-off", "who-is-away", "unexpected-absences", "is-ally-offline"] as const;

export function isDiscordTimeOffSlashCommand(commandName: string): boolean {
  return (TIME_OFF_SLASH_COMMANDS as readonly string[]).includes(commandName);
}
