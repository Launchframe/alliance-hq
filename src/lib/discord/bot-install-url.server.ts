import "server-only";

import { buildDiscordBotInstallUrl } from "@/lib/discord/bot-install-url.shared";

function readDiscordApplicationId(): string | null {
  const raw =
    process.env.DISCORD_APPLICATION_ID?.trim() ||
    process.env.AUTH_DISCORD_ID?.trim() ||
    process.env.DISCORD_CLIENT_ID?.trim();
  return raw || null;
}

export function getDiscordBotInstallRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const origin =
    base ||
    (typeof process.env.VERCEL_URL === "string" && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5175");
  return `${origin}/discord/install/complete`;
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
