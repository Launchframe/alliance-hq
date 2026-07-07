/** Minimum bot permissions for slash commands + channel posts (View Channels, Send Messages, Embed Links, Read Message History). */
export const DISCORD_BOT_INVITE_PERMISSIONS = 84992;

export type DiscordBotInstallUrlInput = {
  clientId: string;
  permissions?: number;
  redirectUri?: string;
  state?: string;
};

/** Builds the Discord OAuth2 URL that adds the bot to a guild with slash-command scope. */
export function buildDiscordBotInstallUrl(input: DiscordBotInstallUrlInput): string | null {
  const clientId = input.clientId.trim();
  if (!clientId) {
    return null;
  }

  const permissions = input.permissions ?? DISCORD_BOT_INVITE_PERMISSIONS;
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: String(permissions),
    scope: "bot applications.commands",
  });

  const redirectUri = input.redirectUri?.trim();
  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
    params.set("response_type", "code");
  }

  const state = input.state?.trim();
  if (state) {
    params.set("state", state);
  }

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
