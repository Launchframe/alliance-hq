import "server-only";

function discordBotToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN?.trim() || null;
}

/** Guild name from Discord API; null when bot token missing or fetch fails. */
export async function fetchDiscordGuildName(
  guildId: string,
): Promise<string | null> {
  const token = discordBotToken();
  if (!token || !guildId.trim()) return null;

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { name?: string };
  return data.name?.trim() || null;
}

/** Channel name from Discord API; null when bot token missing or fetch fails. */
export async function fetchDiscordChannelName(
  channelId: string,
): Promise<string | null> {
  const token = discordBotToken();
  if (!token || !channelId.trim()) return null;

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { name?: string };
  return data.name?.trim() || null;
}
