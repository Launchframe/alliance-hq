const DISCORD_MESSAGE_MAX_CHARS = 1900;

export function truncateDiscordContent(content: string): string {
  if (content.length <= DISCORD_MESSAGE_MAX_CHARS) {
    return content;
  }
  return `${content.slice(0, DISCORD_MESSAGE_MAX_CHARS - 20).trimEnd()}… _(truncated)_`;
}

export async function postDiscordChannelMessage(
  channelId: string,
  content: string,
): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token || !channelId) {
    console.warn("[discord] channel message skipped — not configured.");
    return false;
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: truncateDiscordContent(content) }),
  });

  if (!res.ok) {
    console.error("[discord] channel post failed:", await res.text());
    return false;
  }

  return true;
}
