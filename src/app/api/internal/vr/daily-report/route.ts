import { NextResponse } from "next/server";

import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { formatVrLeaderboard } from "@/lib/vr/leaderboard";
import { loadAllianceLeaderboard } from "@/lib/vr/leaderboard.server";
import {
  listRegisteredGuildsWithReportChannel,
  resolveAllianceForGuild,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const workerSecret = process.env.VR_DAILY_REPORT_SECRET?.trim();
  return Boolean(workerSecret && auth === `Bearer ${workerSecret}`);
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    return NextResponse.json(
      {
        error:
          "No report channels configured. Owners should run /set-vr-report-channel, or set DISCORD_GUILD_ID + DISCORD_VR_REPORT_CHANNEL_ID for legacy single-tenant.",
      },
      { status: 503 },
    );
  }

  let posted = 0;
  let skipped = 0;

  for (const target of targets) {
    try {
      const { seasonKey, allianceTag, rows } = await loadAllianceLeaderboard(target.allianceId);
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
      console.error("[vr-daily-report] failed for guild", target.guildId, error);
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, posted, skipped });
}
