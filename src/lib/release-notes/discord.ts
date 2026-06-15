import type { ReleaseNoteEntry } from "./types";

const DISCORD_EMBED_COLOR = 0x5865f2;
const DISCORD_CONTENT_LIMIT = 1900;
const DISCORD_FIELD_LIMIT = 1024;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function formatBulletList(bullets: string[]): string {
  return bullets.map((bullet) => `• ${bullet}`).join("\n");
}

export function buildDiscordReleaseEmbed(
  entry: ReleaseNoteEntry,
  options?: { releasesUrl?: string },
): {
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields?: Array<{ name: string; value: string }>;
    footer?: { text: string };
    url?: string;
  }>;
} {
  const fields: Array<{ name: string; value: string }> = [];

  if (entry.breaking && entry.breaking.length > 0) {
    fields.push({
      name: "Breaking changes",
      value: truncate(formatBulletList(entry.breaking), DISCORD_FIELD_LIMIT),
    });
  }

  if (entry.maintainerNotes && entry.maintainerNotes.length > 0) {
    fields.push({
      name: "Platform maintainer notes",
      value: truncate(
        formatBulletList(entry.maintainerNotes),
        DISCORD_FIELD_LIMIT,
      ),
    });
  }

  const shippedLabel = entry.shippedAt
    ? entry.shippedAt.slice(0, 10)
    : "today";

  return {
    embeds: [
      {
        title: `🚀 Alliance HQ v${entry.version}`,
        description: truncate(entry.summary || entry.title, DISCORD_FIELD_LIMIT),
        color: DISCORD_EMBED_COLOR,
        ...(fields.length > 0 ? { fields } : {}),
        footer: { text: `Released ${shippedLabel}` },
        ...(options?.releasesUrl ? { url: options.releasesUrl } : {}),
      },
    ],
  };
}

export async function postReleaseNoteToDiscord(options: {
  token: string;
  channelId: string;
  entry: ReleaseNoteEntry;
  releasesUrl?: string;
}): Promise<void> {
  const payload = buildDiscordReleaseEmbed(options.entry, {
    releasesUrl: options.releasesUrl,
  });

  const content =
    options.releasesUrl != null
      ? `Alliance HQ **v${options.entry.version}** is live — ${options.releasesUrl}`
      : `Alliance HQ **v${options.entry.version}** is live.`;

  const res = await fetch(
    `https://discord.com/api/v10/channels/${options.channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: content.slice(0, DISCORD_CONTENT_LIMIT),
        ...payload,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord post failed (${res.status}): ${body}`);
  }
}
