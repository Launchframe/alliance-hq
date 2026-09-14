import "server-only";

import { truncateDiscordContent } from "@/lib/discord/post-message.server";

export type DiscordFollowupMessage = {
  content: string;
  components?: unknown[];
  /** Keep ephemeral when the deferred ACK used flags 64. */
  ephemeral?: boolean;
};

export type DiscordFollowupFile = {
  filename: string;
  bytes: Buffer;
  contentType?: string;
};

export function discordOriginalInteractionUrl(
  applicationId: string,
  interactionToken: string,
): string {
  return `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
}

function deliveryUrl(applicationId: string, interactionToken: string): string {
  const url = new URL(discordOriginalInteractionUrl(applicationId, interactionToken));
  if (process.env.E2E_TEST === "true" && !process.env.VERCEL && process.env.E2E_DISCORD_FOLLOWUP_ORIGIN) {
    const origin = new URL(process.env.E2E_DISCORD_FOLLOWUP_ORIGIN);
    if (origin.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("invalid_test_origin");
    url.protocol = origin.protocol; url.host = origin.host;
  }
  return url.toString();
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
  suppressMentions?: boolean;
}): Promise<boolean> {
  const url = deliveryUrl(
    input.applicationId,
    input.interactionToken,
  );
  const body: Record<string, unknown> = {
    content: truncateDiscordContent(input.content),
    components: input.components ?? [],
    ...(input.suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
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
    );
    return false;
  }
  return true;
}

/**
 * Replace the deferred message and attach files (multipart).
 * Discord expects `payload_json` plus `files[n]` parts; attachment ids in
 * payload_json must match the file part indices.
 */
export async function editDiscordOriginalInteractionWithFiles(input: {
  applicationId: string;
  interactionToken: string;
  content: string;
  files: DiscordFollowupFile[];
  components?: unknown[];
  ephemeral?: boolean;
}): Promise<boolean> {
  const url = deliveryUrl(
    input.applicationId,
    input.interactionToken,
  );
  const attachments = input.files.map((file, index) => ({
    id: index,
    filename: file.filename,
  }));
  const payload: Record<string, unknown> = {
    content: truncateDiscordContent(input.content),
    components: input.components ?? [],
    attachments,
  };
  if (input.ephemeral) {
    payload.flags = 64;
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  for (const [index, file] of input.files.entries()) {
    const blob = new Blob([new Uint8Array(file.bytes)], {
      type: file.contentType ?? "application/octet-stream",
    });
    form.append(`files[${index}]`, blob, file.filename);
  }

  const res = await fetch(url, {
    method: "PATCH",
    body: form,
  });

  if (!res.ok) {
    console.error(
      "[discord] edit original interaction with files failed:",
      res.status,
      await res.text(),
    );
    return false;
  }
  return true;
}
