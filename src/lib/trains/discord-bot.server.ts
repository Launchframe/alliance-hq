import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { getMemberRankAsOf } from "@/lib/trains/rank-history";
import {
  getConductorRecord,
  lockConductorRecord,
  markConductorDepartingSoonAnnounced,
  upsertConductorDraft,
} from "@/lib/trains/repository";
import { getServerCalendarDate, refreshExhaustedPoolsForDay } from "@/lib/trains/service";
import {
  formatTrainDepartingSoonMessage,
  formatTrainReadyMessage,
  groupTrainChannelsByAlliance,
  TRAIN_DEPARTING_SOON_ELAPSED_HOURS,
  TRAIN_PLATFORM_WINDOW_HOURS,
} from "@/lib/trains/discord-bot.shared";
import { resolveTrainNextDeparture } from "@/lib/trains/trains-server-time.shared";
import {
  getAllianceById,
  getAllianceAshedCredential,
  getAllianceTrainDiscordAnnouncementsEnabled,
  listGuildTrainChannelsForAlliance,
  listRegisteredGuildsWithTrainChannel,
} from "@/lib/vr/repository";
import { decryptSecret } from "@/lib/crypto/encrypt";
import { buildBotAshedConnection } from "@/lib/vr/member-roster";

export type TrainAllianceRuntimeContext = {
  allianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection | null;
  operatingMode: "ashed" | "native";
};

export async function resolveTrainAllianceRuntimeContext(
  allianceId: string,
): Promise<TrainAllianceRuntimeContext> {
  const operatingMode = await getAllianceOperatingMode(allianceId);
  if (operatingMode === "native") {
    return {
      allianceId,
      ashedAllianceId: allianceId,
      connection: null,
      operatingMode,
    };
  }

  const alliance = await getAllianceById(allianceId);
  const ashedAllianceId = alliance?.ashedAllianceId?.trim() || allianceId;
  const credential = await getAllianceAshedCredential(allianceId);
  let connection: ParsedConnection | null = null;
  if (credential) {
    try {
      connection = {
        token: decryptSecret(credential.encryptedToken),
        appId: credential.appId,
        originUrl: credential.originUrl,
      };
    } catch {
      connection = null;
    }
  }
  if (!connection) {
    connection = buildBotAshedConnection();
  }

  return {
    allianceId,
    ashedAllianceId,
    connection,
    operatingMode,
  };
}

function trainsUrlForLocale(locale: DiscordBotLocale = "en-US"): string | null {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    return null;
  }
  return buildDiscordBotAppUrl(locale, "/trains");
}

export async function shouldAnnounceTrainForAlliance(
  allianceId: string,
): Promise<boolean> {
  if (!(await getAllianceTrainDiscordAnnouncementsEnabled(allianceId))) {
    return false;
  }
  const channels = await listGuildTrainChannelsForAlliance(allianceId);
  return channels.length > 0;
}

export async function announceTrainReadyToAlliance(input: {
  allianceId: string;
  date: string;
  conductorName: string;
  vipName?: string | null;
  guildId?: string | null;
  locale?: DiscordBotLocale;
}): Promise<{ posted: number; skipped: number }> {
  if (!(await getAllianceTrainDiscordAnnouncementsEnabled(input.allianceId))) {
    return { posted: 0, skipped: 0 };
  }

  const message = formatTrainReadyMessage({
    conductorName: input.conductorName,
    vipName: input.vipName,
    date: input.date,
    trainsUrl: trainsUrlForLocale(input.locale),
  });

  const targets = input.guildId
    ? (await listGuildTrainChannelsForAlliance(input.allianceId)).filter(
        (row) => row.guildId === input.guildId,
      )
    : await listGuildTrainChannelsForAlliance(input.allianceId);

  let posted = 0;
  let skipped = 0;
  for (const target of targets) {
    const ok = await postDiscordChannelMessage(target.channelId, message);
    if (ok) posted += 1;
    else skipped += 1;
  }
  return { posted, skipped };
}

export async function lockTrainForAlliance(input: {
  allianceId: string;
  date: string;
}): Promise<(typeof import("@/lib/db/schema").trainConductorRecords.$inferSelect)> {
  const seasonKey = (await getEffectiveSeasonForAlliance(input.allianceId))
    .seasonKey;
  const record = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (!record) {
    throw new Error("Roll or select a conductor first.");
  }
  if (!record.conductorMemberId || !record.conductorMemberName) {
    throw new Error("Select a conductor before locking.");
  }

  const locked = await lockConductorRecord(record.id, input.allianceId);
  const runtime = await resolveTrainAllianceRuntimeContext(input.allianceId);
  await refreshExhaustedPoolsForDay({
    allianceId: input.allianceId,
    date: input.date,
    connection: runtime.connection,
    ashedAllianceId: runtime.ashedAllianceId,
    seasonKey,
  });
  return locked;
}

export async function maybeAnnounceTrainReady(input: {
  allianceId: string;
  date: string;
  guildId?: string | null;
  conductorName?: string | null;
  vipName?: string | null;
  locale?: DiscordBotLocale;
}): Promise<{ posted: number; skipped: number }> {
  let conductorName = input.conductorName?.trim();
  let vipName = input.vipName;
  if (!conductorName) {
    const seasonKey = (await getEffectiveSeasonForAlliance(input.allianceId))
      .seasonKey;
    const record = await getConductorRecord(
      input.allianceId,
      input.date,
      seasonKey,
    );
    if (!record?.lockedAt || !record.conductorMemberName) {
      return { posted: 0, skipped: 0 };
    }
    conductorName = record.conductorMemberName;
    vipName = record.vipMemberName;
  }

  return announceTrainReadyToAlliance({
    allianceId: input.allianceId,
    date: input.date,
    conductorName,
    vipName,
    guildId: input.guildId,
    locale: input.locale,
  });
}

export async function lockTrainAndAnnounce(input: {
  allianceId: string;
  date: string;
  guildId?: string | null;
  locale?: DiscordBotLocale;
}): Promise<{
  record: (typeof import("@/lib/db/schema").trainConductorRecords.$inferSelect);
  announce: { posted: number; skipped: number };
}> {
  const locked = await lockTrainForAlliance({
    allianceId: input.allianceId,
    date: input.date,
  });
  const announce = await maybeAnnounceTrainReady({
    allianceId: input.allianceId,
    date: input.date,
    guildId: input.guildId,
    conductorName: locked.conductorMemberName,
    vipName: locked.vipMemberName,
    locale: input.locale,
  });
  return { record: locked, announce };
}

export async function draftConductorForAlliance(input: {
  allianceId: string;
  date: string;
  memberId: string;
  memberName: string;
}): Promise<(typeof import("@/lib/db/schema").trainConductorRecords.$inferSelect)> {
  const seasonKey = (await getEffectiveSeasonForAlliance(input.allianceId))
    .seasonKey;
  const existing = await getConductorRecord(
    input.allianceId,
    input.date,
    seasonKey,
  );
  if (existing?.lockedAt) {
    throw new Error("Conductor is already locked for this day.");
  }

  const rankEvent = await getMemberRankAsOf(
    input.allianceId,
    input.memberId,
    input.date,
  );

  return upsertConductorDraft({
    allianceId: input.allianceId,
    date: input.date,
    seasonKey,
    conductorMemberId: input.memberId,
    conductorMemberName: input.memberName,
    conductorRankEventId: rankEvent?.id ?? null,
  });
}


export async function processDepartingSoonReminders(): Promise<{
  posted: number;
  skipped: number;
}> {
  const today = getServerCalendarDate();
  const targets = await listRegisteredGuildsWithTrainChannel();
  const channelsByAlliance = groupTrainChannelsByAlliance(targets);
  let posted = 0;
  let skipped = 0;

  for (const [allianceId, channels] of channelsByAlliance) {
    if (!(await getAllianceTrainDiscordAnnouncementsEnabled(allianceId))) {
      skipped += channels.length;
      continue;
    }

    const seasonKey = (await getEffectiveSeasonForAlliance(allianceId)).seasonKey;
    const record = await getConductorRecord(allianceId, today, seasonKey);
    if (
      !record?.lockedAt ||
      !record.conductorMemberName ||
      record.discordDepartingSoonAt
    ) {
      skipped += channels.length;
      continue;
    }

    const departure = resolveTrainNextDeparture({
      selectedDate: today,
      today,
      lockedAtIso: record.lockedAt.toISOString(),
    });
    if (departure.state !== "on_platform") {
      skipped += channels.length;
      continue;
    }

    const elapsedMs = Date.now() - record.lockedAt.getTime();
    const elapsedHours = elapsedMs / (60 * 60 * 1000);
    if (elapsedHours < TRAIN_DEPARTING_SOON_ELAPSED_HOURS) {
      skipped += channels.length;
      continue;
    }
    if (elapsedHours >= TRAIN_PLATFORM_WINDOW_HOURS) {
      skipped += channels.length;
      continue;
    }

    const message = formatTrainDepartingSoonMessage({
      conductorName: record.conductorMemberName,
      date: today,
      // Public guild channel — no per-member locale; default en-US (no /pt-BR prefix).
      trainsUrl: trainsUrlForLocale(),
    });

    let alliancePosted = 0;
    for (const channel of channels) {
      const ok = await postDiscordChannelMessage(channel.channelId, message);
      if (ok) {
        alliancePosted += 1;
      } else {
        skipped += 1;
      }
    }

    if (alliancePosted > 0) {
      await markConductorDepartingSoonAnnounced(record.id, allianceId);
      posted += alliancePosted;
    }
  }

  return { posted, skipped };
}
