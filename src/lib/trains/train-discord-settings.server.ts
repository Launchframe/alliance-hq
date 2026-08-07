import "server-only";

import {
  fetchDiscordChannelName,
  fetchDiscordGuildName,
} from "@/lib/discord/guild-metadata.server";
import {
  clearGuildTrainChannelForAlliance,
  getAllianceTrainChannelSetterMinRank,
  getAllianceTrainDiscordAnnouncementsEnabled,
  listAllianceDiscordGuildTrainSetup,
  listGuildTrainChannelsForAlliance,
  setAllianceTrainChannelSetterMinRank,
  setAllianceTrainDiscordAnnouncementsEnabled,
} from "@/lib/vr/repository";
import type { TrainDiscordGuildLink } from "@/lib/trains/train-discord-settings.shared";
import {
  parseTrainChannelSetterMinRank,
  type TrainChannelSetterMinRank,
} from "@/lib/trains/train-channel-setter.shared";

export type { TrainDiscordGuildLink };

export type TrainDiscordSettings = {
  announcementsEnabled: boolean;
  channelSetterMinRank: TrainChannelSetterMinRank;
  guildChannelCount: number;
  guilds: TrainDiscordGuildLink[];
  canManage: boolean;
  /** Alliance owner may configure who can run `/set-train-channel`. */
  canConfigureChannelSetterMinRank: boolean;
};

async function enrichGuildLinks(
  guilds: Awaited<ReturnType<typeof listAllianceDiscordGuildTrainSetup>>,
): Promise<TrainDiscordGuildLink[]> {
  return Promise.all(
    guilds.map(async (guild) => {
      const [guildName, trainChannelName] = await Promise.all([
        fetchDiscordGuildName(guild.guildId),
        guild.trainChannelId
          ? fetchDiscordChannelName(guild.trainChannelId)
          : Promise.resolve(null),
      ]);
      return {
        guildId: guild.guildId,
        guildName,
        hasTrainChannel: guild.hasTrainChannel,
        trainChannelId: guild.trainChannelId,
        trainChannelName,
        discordOpenUrl: guild.discordOpenUrl,
      };
    }),
  );
}

export async function loadTrainDiscordSettings(
  allianceId: string,
  canManage: boolean,
  canConfigureChannelSetterMinRank = false,
): Promise<TrainDiscordSettings> {
  const [announcementsEnabled, channelSetterMinRank, channels, guildRows] =
    await Promise.all([
      getAllianceTrainDiscordAnnouncementsEnabled(allianceId),
      getAllianceTrainChannelSetterMinRank(allianceId),
      listGuildTrainChannelsForAlliance(allianceId),
      listAllianceDiscordGuildTrainSetup(allianceId),
    ]);
  const guilds = await enrichGuildLinks(guildRows);
  return {
    announcementsEnabled,
    channelSetterMinRank: parseTrainChannelSetterMinRank(channelSetterMinRank),
    guildChannelCount: channels.length,
    guilds,
    canManage,
    canConfigureChannelSetterMinRank,
  };
}

export async function saveTrainDiscordSettings(
  allianceId: string,
  input: {
    announcementsEnabled?: boolean;
    channelSetterMinRank?: TrainChannelSetterMinRank;
  },
  canConfigureChannelSetterMinRank: boolean,
  canManage: boolean,
): Promise<TrainDiscordSettings> {
  if (input.announcementsEnabled !== undefined) {
    await setAllianceTrainDiscordAnnouncementsEnabled(
      allianceId,
      input.announcementsEnabled,
    );
  }
  if (
    input.channelSetterMinRank !== undefined &&
    canConfigureChannelSetterMinRank
  ) {
    await setAllianceTrainChannelSetterMinRank(
      allianceId,
      input.channelSetterMinRank,
    );
  }
  return loadTrainDiscordSettings(
    allianceId,
    canManage,
    canConfigureChannelSetterMinRank,
  );
}

export async function revokeGuildTrainChannel(
  allianceId: string,
  guildId: string,
  canManage: boolean,
  canConfigureChannelSetterMinRank: boolean,
): Promise<{ cleared: boolean; settings: TrainDiscordSettings }> {
  const cleared = await clearGuildTrainChannelForAlliance(allianceId, guildId);
  const settings = await loadTrainDiscordSettings(
    allianceId,
    canManage,
    canConfigureChannelSetterMinRank,
  );
  return { cleared, settings };
}

export function trainDiscordConfigured(settings: TrainDiscordSettings): boolean {
  return settings.announcementsEnabled && settings.guildChannelCount > 0;
}
