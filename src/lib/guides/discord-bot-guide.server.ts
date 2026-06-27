import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";

import {
  buildDiscordBotGuidePath,
  type DiscordBotGuideRoleSlug,
} from "@/lib/guides/discord-bot-guide.shared";

export function buildDiscordBotGuideUrl(
  locale: DiscordBotLocale,
  options?: { role?: DiscordBotGuideRoleSlug; step?: string },
): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const origin =
    base ||
    (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5175");
  return `${origin}${buildDiscordBotGuidePath(locale, options)}`;
}
