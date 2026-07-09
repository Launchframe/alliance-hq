import "server-only";

import { buildDiscordBotInstallUrl } from "@/lib/discord/bot-install-url.shared";
import { discordBotAppOrigin } from "@/lib/discord/app-url.shared";

function readDiscordApplicationId(): string | null {
  const raw =
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    process.env.AUTH_DISCORD_ID?.trim() ||
    process.env.DISCORD_CLIENT_ID?.trim();
  return raw || null;
}

export function getDiscordBotInstallRedirectUri(): string {
  return `${discordBotAppOrigin()}/discord/install/complete`;
}

export function getDiscordBotInstallUrl(): string | null {
  const clientId = readDiscordApplicationId();
  if (!clientId) {
    return null;
  }
  return buildDiscordBotInstallUrl({ clientId });
}

export function buildDiscordBotInstallUrlWithState(state: string): string | null {
  const clientId = readDiscordApplicationId();
  if (!clientId) {
    return null;
  }
  return buildDiscordBotInstallUrl({
    clientId,
    redirectUri: getDiscordBotInstallRedirectUri(),
    state,
  });
}

export function isDiscordBotInstallConfigured(): boolean {
  return readDiscordApplicationId() != null;
}
