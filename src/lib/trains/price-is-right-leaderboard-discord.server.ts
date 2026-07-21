import "server-only";

import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { addCalendarDays } from "@/lib/trains/game-time";
import { formatPriceIsRightLeaderboardDiscordMessage } from "@/lib/trains/price-is-right-leaderboard.shared";
import { loadPriceIsRightVsLeaderboard } from "@/lib/trains/price-is-right-leaderboard.server";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { isPriceIsRightPaintTemplate } from "@/lib/trains/heavy-hitter-pool.shared";
import {
  getAllianceTrainDiscordAnnouncementsEnabled,
  listRegisteredGuildsWithTrainChannel,
} from "@/lib/vr/repository";

function trainsUrlForLocale(locale: DiscordBotLocale = "en-US"): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return null;
  return buildDiscordBotAppUrl(locale, "/trains");
}

export async function postPriceIsRightLeaderboardToDiscord(input: {
  allianceId: string;
  trainDate: string;
}): Promise<{ posted: number; skipped: number }> {
  if (!(await getAllianceTrainDiscordAnnouncementsEnabled(input.allianceId))) {
    return { posted: 0, skipped: 1 };
  }

  const { seasonKey } = await getEffectiveSeasonForAlliance(input.allianceId);
  const dayConfig = await resolveRollDayConfig(
    input.allianceId,
    input.trainDate,
    seasonKey,
  );
  if (!isPriceIsRightPaintTemplate(dayConfig.paintTemplate)) {
    return { posted: 0, skipped: 1 };
  }

  const leaderboard = await loadPriceIsRightVsLeaderboard({
    allianceId: input.allianceId,
    trainDate: input.trainDate,
  });
  if (leaderboard.podium.length === 0) {
    return { posted: 0, skipped: 1 };
  }

  const message = formatPriceIsRightLeaderboardDiscordMessage({
    trainDate: input.trainDate,
    scoreDate: leaderboard.scoreDate,
    entries: leaderboard.entries,
    trainsUrl: trainsUrlForLocale(),
  });

  const channels = await listRegisteredGuildsWithTrainChannel();
  const allianceChannels = channels.filter(
    (target) => target.allianceId === input.allianceId,
  );
  if (allianceChannels.length === 0) {
    return { posted: 0, skipped: 1 };
  }

  let posted = 0;
  let skipped = 0;
  for (const target of allianceChannels) {
    const ok = await postDiscordChannelMessage(target.channelId, message);
    if (ok) posted += 1;
    else skipped += 1;
  }

  return { posted, skipped };
}

/**
 * After prior-day VS scores are uploaded for `vsRecordedDate`, announce the
 * podium when the following train day is Price Is Freight.
 */
export async function announcePriceIsRightLeaderboardAfterVsUpload(input: {
  allianceId: string;
  vsRecordedDate: string;
}): Promise<{ posted: number; skipped: number }> {
  const trainDate = addCalendarDays(input.vsRecordedDate, 1);
  return postPriceIsRightLeaderboardToDiscord({
    allianceId: input.allianceId,
    trainDate,
  });
}
