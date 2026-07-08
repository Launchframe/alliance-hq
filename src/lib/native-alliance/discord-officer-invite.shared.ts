/** Discord user snowflake — 17–20 decimal digits. */
const DISCORD_USER_ID_PATTERN = /^\d{17,20}$/;

export function isValidDiscordUserId(value: string): boolean {
  return DISCORD_USER_ID_PATTERN.test(value.trim());
}

export function normalizeDiscordUserId(value: string): string {
  return value.trim();
}
