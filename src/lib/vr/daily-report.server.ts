import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { formatVrLeaderboard } from "@/lib/vr/leaderboard";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";
import {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
} from "@/lib/vr/repository";

export type VrDailyReportTarget = {
  guildId: string;
  allianceId: string;
  channelId: string;
};

export async function resolveVrDailyReportTargets(): Promise<
  VrDailyReportTarget[]
> {
  const targets = await listRegisteredGuildsWithReportChannel();

  if (targets.length === 0) {
    const channelId = process.env.DISCORD_VR_REPORT_CHANNEL_ID?.trim();
    const guildId = process.env.DISCORD_GUILD_ID?.trim();
    if (channelId && guildId) {
      const allianceId = await resolveAllianceForGuild(guildId);
      if (allianceId) {
        targets.push({ guildId, allianceId, channelId });
      }
    }
  }

  return targets;
}

async function claimVrDailyReportPost(input: {
  guildId: string;
  allianceId: string;
  reportDate: string;
}): Promise<string | null> {
  const db = getDb();
  const claimId = nanoid();
  const [claimed] = await db
    .insert(schema.vrDailyReportPosts)
    .values({
      id: claimId,
      guildId: input.guildId,
      allianceId: input.allianceId,
      reportDate: input.reportDate,
    })
    .onConflictDoNothing({
      target: [
        schema.vrDailyReportPosts.guildId,
        schema.vrDailyReportPosts.reportDate,
      ],
    })
    .returning({ id: schema.vrDailyReportPosts.id });
  return claimed?.id ?? null;
}

async function clearVrDailyReportPostClaim(input: {
  guildId: string;
  reportDate: string;
}): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.vrDailyReportPosts)
    .where(
      and(
        eq(schema.vrDailyReportPosts.guildId, input.guildId),
        eq(schema.vrDailyReportPosts.reportDate, input.reportDate),
      ),
    );
}

/**
 * Post top-25 VR standings to each guild report channel, once per
 * guild+server-calendar-day. Claim-before-post so cron retries / double
 * deliveries cannot spam; clear the claim when Discord delivery fails so
 * the next tick can retry.
 */
export async function processVrDailyReports(options?: {
  now?: Date;
}): Promise<{ posted: number; skipped: number; configured: number }> {
  const targets = await resolveVrDailyReportTargets();
  if (targets.length === 0) {
    return { posted: 0, skipped: 0, configured: 0 };
  }

  const reportDate = getServerCalendarDate(options?.now);
  let posted = 0;
  let skipped = 0;

  for (const target of targets) {
    const claimId = await claimVrDailyReportPost({
      guildId: target.guildId,
      allianceId: target.allianceId,
      reportDate,
    });
    if (!claimId) {
      skipped += 1;
      continue;
    }

    let delivered = false;
    try {
      const { seasonKey, allianceTag, rows } = await loadAllianceLeaderboard(
        target.allianceId,
      );
      const message = formatVrLeaderboard(rows, seasonKey, {
        limit: 25,
        allianceTag,
      });
      delivered = await postDiscordChannelMessage(target.channelId, message);
    } catch (error) {
      console.error(
        "[vr-daily-report] failed for guild",
        target.guildId,
        error,
      );
      delivered = false;
    }

    if (delivered) {
      posted += 1;
    } else {
      await clearVrDailyReportPostClaim({
        guildId: target.guildId,
        reportDate,
      });
      skipped += 1;
    }
  }

  return { posted, skipped, configured: targets.length };
}
