import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { discordBotAppOrigin } from "@/lib/discord/app-url.shared";

import {
  buildDiscordBotGuidePath,
  type DiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";

export function buildDiscordBotGuideUrl(
  locale: DiscordBotLocale,
  options?: { role?: DiscordBotGuideRoleSlug; step?: string },
): string {
  // buildDiscordBotGuidePath embeds the locale segment; do not also pass through buildDiscordBotAppUrl.
  return `${discordBotAppOrigin()}${buildDiscordBotGuidePath(locale, options)}`;
}
