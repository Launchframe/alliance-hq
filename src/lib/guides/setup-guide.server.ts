import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";

function appOrigin(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return (
    base ||
    (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5175")
  );
}

function localePrefix(locale: DiscordBotLocale): string {
  return locale === "en-US" ? "" : `/${locale}`;
}

export function buildR5GettingStartedGuideUrl(locale: DiscordBotLocale): string {
  return `${appOrigin()}${localePrefix(locale)}/guides/getting-started`;
}

export function buildDiscordInstallWizardUrl(locale: DiscordBotLocale): string {
  return `${appOrigin()}${localePrefix(locale)}/discord/setup`;
}
