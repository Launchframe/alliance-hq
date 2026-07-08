import type { DiscordBotLocale } from "@/lib/discord/i18n";

/** Canonical public origin for Discord bot–emitted Alliance HQ links. */
export function discordBotAppOrigin(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (base) {
    return base;
  }
  if (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:5175";
}

export function discordBotLocalePathPrefix(locale: DiscordBotLocale): string {
  return locale === "en-US" ? "" : `/${locale}`;
}

/** Absolute Alliance HQ URL with locale prefix (`as-needed`: en-US has none). */
export function buildDiscordBotAppUrl(
  locale: DiscordBotLocale,
  path: string,
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${discordBotAppOrigin()}${discordBotLocalePathPrefix(locale)}${normalized}`;
}
