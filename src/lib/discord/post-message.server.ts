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
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  });

  if (!res.ok) {
    console.error("[discord] channel post failed:", await res.text());
    return false;
  }

  return true;
}
