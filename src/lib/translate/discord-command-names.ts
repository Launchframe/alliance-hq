/**
 * Message context-menu command (Apps → Translate on any message). Context menu
 * command names may contain capitals, unlike slash commands.
 */
export const DISCORD_TRANSLATE_MESSAGE_COMMAND = "Translate";

/** Slash command that stores the caller's preferred translation language. */
export const DISCORD_TRANSLATION_LANGUAGE_COMMAND = "translation-language";

/** Owner-only slash command that toggles message translation for the guild. */
export const DISCORD_SET_TRANSLATION_COMMAND = "set-translation";

export function isDiscordTranslateMessageCommand(
  commandName: string | undefined,
): boolean {
  return commandName === DISCORD_TRANSLATE_MESSAGE_COMMAND;
}
