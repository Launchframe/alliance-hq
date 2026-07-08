import "server-only";

const DISCORD_CDN_HOST = "cdn.discordapp.com";

export type DiscordAttachmentMeta = {
  id: string;
  url: string;
  filename?: string;
  contentType?: string;
};

export function parseResolvedAttachment(
  payload: {
    data?: {
      options?: Array<{ name: string; type: number; value?: unknown }>;
      resolved?: {
        attachments?: Record<
          string,
          { url?: string; filename?: string; content_type?: string }
        >;
      };
    };
  },
  optionName: string,
): DiscordAttachmentMeta | null {
  const option = payload.data?.options?.find((row) => row.name === optionName);
  if (!option || typeof option.value !== "string") return null;
  const attachmentId = option.value;
  const attachment = payload.data?.resolved?.attachments?.[attachmentId];
  if (!attachment?.url) return null;
  return {
    id: attachmentId,
    url: attachment.url,
    filename: attachment.filename,
    contentType: attachment.content_type,
  };
}

export async function downloadDiscordAttachment(
  attachment: DiscordAttachmentMeta,
): Promise<Buffer> {
  const url = new URL(attachment.url);
  if (url.hostname !== DISCORD_CDN_HOST) {
    throw new Error("Unexpected attachment host");
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
