import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { formatVideoPendingApprovalDiscordMessage } from "@/lib/video/pending-approval-discord.shared";

async function listR4ChannelIdsForAlliance(
  allianceId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({
      channelId: schema.discordGuildAlliances.r4ChannelId,
    })
    .from(schema.discordGuildAlliances)
    .where(
      and(
        eq(schema.discordGuildAlliances.allianceId, allianceId),
        isNotNull(schema.discordGuildAlliances.r4ChannelId),
      ),
    );
  return rows
    .map((row) => row.channelId?.trim() ?? "")
    .filter((id) => id.length > 0);
}

async function uploaderDisplayName(
  hqUserId: string | null,
): Promise<string | null> {
  if (!hqUserId) return null;
  const db = getDb();
  const [user] = await db
    .select({ displayName: schema.hqUsers.displayName })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return user?.displayName?.trim() || null;
}

/**
 * Best-effort R4-channel ping when a video first enters pending approval.
 * Never throws — upload must succeed even if Discord is unset.
 */
export async function announceVideoPendingApproval(input: {
  allianceId: string | null;
  fileName: string | null;
  scoreTarget: string;
  enqueuedByHqUserId: string | null;
}): Promise<void> {
  const allianceId = input.allianceId?.trim();
  if (!allianceId) return;

  try {
    const channelIds = await listR4ChannelIdsForAlliance(allianceId);
    if (channelIds.length === 0) return;

    const uploader = await uploaderDisplayName(input.enqueuedByHqUserId);
    const queueUrl = buildDiscordBotAppUrl("en-US", "/tools/video-upload/queue");
    const message = formatVideoPendingApprovalDiscordMessage({
      uploader,
      fileName: input.fileName?.trim() || input.scoreTarget,
      leaderboard: input.scoreTarget,
      queueUrl,
    });

    await Promise.all(
      channelIds.map((channelId) =>
        postDiscordChannelMessage(channelId, message),
      ),
    );
  } catch (err) {
    console.error("[video] pending-approval Discord announce failed", err);
  }
}
