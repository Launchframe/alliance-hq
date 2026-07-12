import { truncateDiscordContent } from "@/lib/discord/post-message.server";

export type DiscordFollowupMessage = {
  content: string;
  components?: unknown[];
  /** Keep ephemeral when the deferred ACK used flags 64. */
  ephemeral?: boolean;
};

export function discordOriginalInteractionUrl(
  applicationId: string,
  interactionToken: string,
): string {
  return `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
}

/**
 * Replace the deferred "thinking" message. Interaction token auth is enough —
 * do not send the bot token on this webhook route.
 */
export async function editDiscordOriginalInteraction(input: {
  applicationId: string;
  interactionToken: string;
  content: string;
  components?: unknown[];
  ephemeral?: boolean;
}): Promise<boolean> {
  const url = discordOriginalInteractionUrl(
    input.applicationId,
    input.interactionToken,
  );
  const body: Record<string, unknown> = {
    content: truncateDiscordContent(input.content),
    components: input.components ?? [],
  };
  if (input.ephemeral) {
    body.flags = 64;
  }

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(
      "[discord] edit original interaction failed:",
      res.status,
      await res.text(),
    );
    return false;
  }
  return true;
}
