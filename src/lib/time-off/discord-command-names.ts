/** Member-facing time-off slash commands (any member with a linked commander). */
export const TIME_OFF_MEMBER_SLASH_COMMANDS = [
  "my-time-off",
  "is-ally-offline",
] as const;

/** Officer-gated time-off slash commands (R4+ / owner via `callerCanRunVrReport`). */
export const TIME_OFF_OFFICER_SLASH_COMMANDS = [
  "set-time-off",
  "cancel-time-off",
  "who-is-away",
  "unexpected-absences",
] as const;

export const TIME_OFF_SLASH_COMMANDS = [
  ...TIME_OFF_MEMBER_SLASH_COMMANDS,
  ...TIME_OFF_OFFICER_SLASH_COMMANDS,
] as const;

export type TimeOffSlashCommand = (typeof TIME_OFF_SLASH_COMMANDS)[number];

export function isDiscordTimeOffSlashCommand(
  commandName: string | undefined,
): commandName is TimeOffSlashCommand {
  return (
    commandName != null &&
    (TIME_OFF_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}

export function isDiscordTimeOffOfficerSlashCommand(
  commandName: string | undefined,
): boolean {
  return (
    commandName != null &&
    (TIME_OFF_OFFICER_SLASH_COMMANDS as readonly string[]).includes(commandName)
  );
}
