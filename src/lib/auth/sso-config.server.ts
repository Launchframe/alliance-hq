import "server-only";

import type { AuthSsoAvailability } from "@/lib/auth/sso-config.shared";

function readEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    readEnv("AUTH_GOOGLE_ID", "GOOGLE_CLIENT_ID") &&
      readEnv("AUTH_GOOGLE_SECRET", "GOOGLE_CLIENT_SECRET"),
  );
}

export function isDiscordOAuthConfigured(): boolean {
  return Boolean(
    readEnv("AUTH_DISCORD_ID", "DISCORD_CLIENT_ID", "DISCORD_APPLICATION_ID") &&
      readEnv("AUTH_DISCORD_SECRET", "DISCORD_CLIENT_SECRET"),
  );
}

export function getAuthSsoAvailability(): AuthSsoAvailability {
  return {
    google: isGoogleOAuthConfigured(),
    discord: isDiscordOAuthConfigured(),
  };
}
