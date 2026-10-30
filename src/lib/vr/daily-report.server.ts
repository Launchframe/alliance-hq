import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessageResult } from "@/lib/discord/post-message.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { formatVrLeaderboard } from "@/lib/vr/leaderboard";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";
import {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
} from "@/lib/vr/repository";

/** Stale `in_flight` claims older than this can be reclaimed after a crash. */
export const VR_DAILY_REPORT_CLAIM_LEASE_MS = 15 * 60 * 1000;

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
  now?: Date;
}): Promise<string | null> {
  const db = getDb();
  const now = input.now ?? new Date();
  const claimId = nanoid();
  const [inserted] = await db
    .insert(schema.vrDailyReportPosts)
    .values({
      id: claimId,
      guildId: input.guildId,
      allianceId: input.allianceId,
      reportDate: input.reportDate,
      status: "in_flight",
      claimedAt: now,
      postedAt: null,
    })
    .onConflictDoNothing({
      target: [
        schema.vrDailyReportPosts.guildId,
        schema.vrDailyReportPosts.reportDate,
      ],
    })
    .returning({ id: schema.vrDailyReportPosts.id });
  if (inserted) {
    return inserted.id;
  }

  const leaseCutoff = new Date(now.getTime() - VR_DAILY_REPORT_CLAIM_LEASE_MS);
  const [reclaimed] = await db
    .update(schema.vrDailyReportPosts)
    .set({
      allianceId: input.allianceId,
      claimedAt: now,
      status: "in_flight",
      postedAt: null,
    })
    .where(
      and(
        eq(schema.vrDailyReportPosts.guildId, input.guildId),
        eq(schema.vrDailyReportPosts.reportDate, input.reportDate),
        eq(schema.vrDailyReportPosts.status, "in_flight"),
        lt(schema.vrDailyReportPosts.claimedAt, leaseCutoff),
      ),
    )
    .returning({ id: schema.vrDailyReportPosts.id });
  return reclaimed?.id ?? null;
}

async function markVrDailyReportPosted(input: {
  guildId: string;
  reportDate: string;
  now?: Date;
}): Promise<void> {
  const db = getDb();
  const now = input.now ?? new Date();
  await db
    .update(schema.vrDailyReportPosts)
    .set({ status: "posted", postedAt: now })
    .where(
      and(
        eq(schema.vrDailyReportPosts.guildId, input.guildId),
        eq(schema.vrDailyReportPosts.reportDate, input.reportDate),
      ),
    );
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
 * deliveries cannot spam. Expired `in_flight` leases are reclaimable after
 * crashes. Ambiguous Discord outcomes keep the claim (treated as posted) so
 * a lost response cannot cause a duplicate message; definite pre-send /
 * HTTP failures clear the claim for the next tick.
 */
export async function processVrDailyReports(options?: {
  now?: Date;
}): Promise<{ posted: number; skipped: number; configured: number }> {
  const targets = await resolveVrDailyReportTargets();
  if (targets.length === 0) {
    return { posted: 0, skipped: 0, configured: 0 };
  }

  const now = options?.now ?? new Date();
  const reportDate = getServerCalendarDate(now);
  let posted = 0;
  let skipped = 0;

  for (const target of targets) {
    const claimId = await claimVrDailyReportPost({
      guildId: target.guildId,
      allianceId: target.allianceId,
      reportDate,
      now,
    });
    if (!claimId) {
      skipped += 1;
      continue;
    }

    try {
      const { seasonKey, allianceTag, rows } = await loadAllianceLeaderboard(
        target.allianceId,
      );
      const message = formatVrLeaderboard(rows, seasonKey, {
        limit: 25,
        allianceTag,
      });
      const result = await postDiscordChannelMessageResult(
        target.channelId,
        message,
        { source: "vr.daily_report" },
      );

      if (result.ok || result.retryMayDuplicate) {
        await markVrDailyReportPosted({
          guildId: target.guildId,
          reportDate,
          now,
        });
        posted += 1;
      } else {
        await clearVrDailyReportPostClaim({
          guildId: target.guildId,
          reportDate,
        });
        skipped += 1;
      }
    } catch (error) {
      console.error(
        "[vr-daily-report] failed for guild",
        target.guildId,
        error,
      );
      await clearVrDailyReportPostClaim({
        guildId: target.guildId,
        reportDate,
      });
      skipped += 1;
    }
  }

  return { posted, skipped, configured: targets.length };
}
