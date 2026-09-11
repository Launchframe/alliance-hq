import "server-only";

export type WorkDeliveryResult = { status: "sent"; messageId: string; channelId: string } | { status: "pending" | "uncertain" | "cancelled" };

export async function sendPrivateWorkDigest(input: { token: string; discordUserId: string; content: string; nonce: string; authorizeSend: (channelId: string) => Promise<boolean> }): Promise<WorkDeliveryResult> {
  const headers = { Authorization: `Bot ${input.token}`, "Content-Type": "application/json" };
  let channelId: string;
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/channels", { method: "POST", headers, body: JSON.stringify({ recipient_id: input.discordUserId }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { status: "pending" };
    const channel = await response.json() as { id?: string };
    if (!channel.id || typeof channel.id !== "string") return { status: "pending" };
    channelId = channel.id;
  } catch { return { status: "pending" }; }
  if (!await input.authorizeSend(channelId)) return { status: "cancelled" };
  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: "POST", headers,
      body: JSON.stringify({ content: input.content, nonce: input.nonce, enforce_nonce: true, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000) });
    if (response.status >= 500) return { status: "uncertain" };
    if (!response.ok) return { status: "pending" };
    const message = await response.json() as { id?: string };
    return typeof message.id === "string" ? { status: "sent", messageId: message.id, channelId } : { status: "uncertain" };
  } catch { return { status: "uncertain" }; }
}
