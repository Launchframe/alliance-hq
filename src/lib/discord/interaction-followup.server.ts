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
  const url = discordOriginalInteractionUrl(
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
