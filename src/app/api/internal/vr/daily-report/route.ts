import { NextResponse } from "next/server";

import { buildLeaderboardRows, formatDailyDiscordReport } from "@/lib/vr/leaderboard";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  listDiscordLinksByAlliance,
  listLeaderboardRows,
  resolveAllianceForGuild,
  resolveDiscordAllianceId,
  resolveSeasonKey,
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

async function postDiscordChannelMessage(content: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_VR_REPORT_CHANNEL_ID?.trim();
  if (!token || !channelId) {
    console.warn("[vr-daily-report] Discord channel not configured.");
    return;
  }
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  });
  if (!res.ok) {
    console.error("[vr-daily-report] Discord post failed:", await res.text());
  }
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const allianceId = guildId
    ? await resolveAllianceForGuild(guildId)
    : await resolveDiscordAllianceId();
  if (!allianceId) {
    return NextResponse.json(
      {
        error:
          "No alliance configured. Register the guild with /link-alliance or set DISCORD_GUILD_ID with a registered server.",
      },
      { status: 503 },
    );
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  const [seasonRows, links, members] = await Promise.all([
    listLeaderboardRows(allianceId, seasonKey),
    listDiscordLinksByAlliance(allianceId),
    loadAllianceMembersForBot(allianceId),
  ]);
  const rows = buildLeaderboardRows(seasonRows, members, links);
  const message = formatDailyDiscordReport(rows, seasonKey);
  await postDiscordChannelMessage(message);

  return NextResponse.json({ ok: true, seasonKey, count: rows.length });
}
