import { NextResponse } from "next/server";

import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { authorizeCron } from "@/lib/ops/cron-auth";
import { runCron } from "@/lib/ops/run-cron";
import { formatVrLeaderboard } from "@/lib/vr/leaderboard";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";
import {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (
    !authorizeCron(request, { alternateEnvKeys: ["VR_DAILY_REPORT_SECRET"] })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return runCron("vr-daily-report", async () => {
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

    if (targets.length === 0) {
      return {
        processed: 0,
        httpStatus: 503,
        // Expected until owners configure a channel — do not page ops.
        skipFailureAlert: true,
        error:
          "No report channels configured. Owners should run /set-vr-report-channel, or set DISCORD_GUILD_ID + DISCORD_VR_REPORT_CHANNEL_ID for legacy single-tenant.",
      };
    }

    let posted = 0;
    let skipped = 0;

    for (const target of targets) {
      try {
        const { seasonKey, allianceTag, rows } = await loadAllianceLeaderboard(
          target.allianceId,
        );
        const message = formatVrLeaderboard(rows, seasonKey, {
          limit: 25,
          allianceTag,
        });
        const ok = await postDiscordChannelMessage(target.channelId, message);
        if (ok) {
          posted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        console.error(
          "[vr-daily-report] failed for guild",
          target.guildId,
          error,
        );
        skipped += 1;
      }
    }

    return { processed: posted, posted, skipped };
  });
}
