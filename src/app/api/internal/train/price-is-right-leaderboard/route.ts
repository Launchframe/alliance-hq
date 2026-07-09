import { NextResponse } from "next/server";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { formatPriceIsRightLeaderboardDiscordMessage } from "@/lib/trains/price-is-right-leaderboard.shared";
import { loadPriceIsRightVsLeaderboard } from "@/lib/trains/price-is-right-leaderboard.server";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import {
  getAllianceTrainDiscordAnnouncementsEnabled,
  listRegisteredGuildsWithTrainChannel,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const workerSecret = process.env.TRAIN_PIR_LEADERBOARD_SECRET?.trim();
  return Boolean(workerSecret && auth === `Bearer ${workerSecret}`);
}

function trainsUrlForLocale(locale: DiscordBotLocale = "en-US"): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return null;
  return buildDiscordBotAppUrl(locale, "/trains");
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = getServerCalendarDate();
  const targets = await listRegisteredGuildsWithTrainChannel();
  let posted = 0;
  let skipped = 0;

  for (const target of targets) {
    try {
      if (!(await getAllianceTrainDiscordAnnouncementsEnabled(target.allianceId))) {
        skipped += 1;
        continue;
      }

      const { seasonKey } = await getEffectiveSeasonForAlliance(target.allianceId);
      const dayConfig = await resolveRollDayConfig(
        target.allianceId,
        today,
        seasonKey,
      );
      if (dayConfig.paintTemplate !== "price_is_right") {
        skipped += 1;
        continue;
      }

      const leaderboard = await loadPriceIsRightVsLeaderboard({
        allianceId: target.allianceId,
        trainDate: today,
      });
      if (leaderboard.podium.length === 0) {
        skipped += 1;
        continue;
      }

      const message = formatPriceIsRightLeaderboardDiscordMessage({
        trainDate: today,
        scoreDate: leaderboard.scoreDate,
        entries: leaderboard.entries,
        trainsUrl: trainsUrlForLocale(),
      });

      const ok = await postDiscordChannelMessage(target.channelId, message);
      if (ok) posted += 1;
      else skipped += 1;
    } catch (error) {
      console.error(
        "[train-pir-leaderboard] failed for alliance",
        target.allianceId,
        error,
      );
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, posted, skipped, date: today });
}
