import "server-only";

export const isDiscordId = (value: unknown): value is string => typeof value === "string" && /^\d{15,25}$/.test(value);
export type PlanDeliveryResult = { status: "sent"; messageId: string } | { status: "pending" | "cancelled" | "uncertain" };

export async function verifyPlanChannel(guildId: string, channelId: string, token = process.env.DISCORD_BOT_TOKEN): Promise<boolean> {
  if (!token || !isDiscordId(guildId) || !isDiscordId(channelId)) return false;
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const channel = await response.json() as { id?: string; guild_id?: string; type?: number };
    return channel.id === channelId && channel.guild_id === guildId && (channel.type === 0 || channel.type === 5);
  } catch { return false; }
}

export async function sendPlanMessage(input: {
  token: string; nonce: string; target: { discordUserId: string } | { channelId: string; guildId: string };
  authorize: (channelId: string) => Promise<string | null>;
}): Promise<PlanDeliveryResult> {
  const headers = { Authorization: `Bot ${input.token}`, "Content-Type": "application/json" };
  let channelId: string;
  if ("discordUserId" in input.target) {
    if (!isDiscordId(input.target.discordUserId)) return { status: "cancelled" };
    try {
      const response = await fetch("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers, body: JSON.stringify({ recipient_id: input.target.discordUserId }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return { status: "pending" };
      const channel = await response.json() as { id?: string };
      if (!isDiscordId(channel.id)) return { status: "pending" };
      channelId = channel.id;
    } catch { return { status: "pending" }; }
  } else {
    if (!await verifyPlanChannel(input.target.guildId, input.target.channelId, input.token)) return { status: "pending" };
    channelId = input.target.channelId;
  }
  const content = await input.authorize(channelId);
  if (!content || content.length > 2000) return { status: "cancelled" };
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: "POST", headers, body: JSON.stringify({ content, nonce: input.nonce, enforce_nonce: true, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000) });
    if (response.status >= 500) return { status: "uncertain" };
    if (!response.ok) return { status: "pending" };
    const body = await response.json() as { id?: string };
    return isDiscordId(body.id) ? { status: "sent", messageId: body.id } : { status: "uncertain" };
  } catch { return { status: "uncertain" }; }
}
