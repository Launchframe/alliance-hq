import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";

export function buildR5GettingStartedGuideUrl(locale: DiscordBotLocale): string {
  return buildDiscordBotAppUrl(locale, "/guides/getting-started");
}

export function buildDiscordInstallWizardUrl(locale: DiscordBotLocale): string {
  return buildDiscordBotAppUrl(locale, "/discord/setup");
}
