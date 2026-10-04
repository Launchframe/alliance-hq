import "server-only";

import type { DiscordSlashOption } from "@/lib/discord/interactions";

const DISCORD_ATTACHMENT_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

export type DiscordAttachmentMeta = {
  id: string;
  url: string;
  filename?: string;
  contentType?: string;
};

function walkSlashOptions(
  options: DiscordSlashOption[] | undefined,
  visit: (option: DiscordSlashOption) => void,
) {
  for (const option of options ?? []) {
    if (option.type === 1 || option.type === 2) {
      walkSlashOptions(option.options, visit);
      continue;
    }
    visit(option);
  }
}

export function parseResolvedAttachment(
  payload: {
    data?: {
      options?: DiscordSlashOption[];
      resolved?: {
        attachments?: Record<
          string,
          {
            url?: string;
            proxy_url?: string;
            filename?: string;
            content_type?: string;
          }
        >;
      };
    };
  },
  optionName: string,
): DiscordAttachmentMeta | null {
  let attachmentId: string | null = null;
  walkSlashOptions(payload.data?.options, (option) => {
    if (option.name === optionName && typeof option.value === "string") {
      attachmentId = option.value;
    }
  });
  if (!attachmentId) return null;

  const attachment = payload.data?.resolved?.attachments?.[attachmentId];
  const url = attachment?.url ?? attachment?.proxy_url;
  if (!url) return null;

  return {
    id: attachmentId,
    url,
    filename: attachment?.filename,
    contentType: attachment?.content_type,
  };
}

export async function downloadDiscordAttachment(
  attachment: DiscordAttachmentMeta,
): Promise<Buffer> {
  const url = new URL(attachment.url);
  if (!DISCORD_ATTACHMENT_HOSTS.has(url.hostname)) {
    throw new Error("Unexpected attachment host");
  }
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
