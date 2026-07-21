import "server-only";

import {
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

export async function loadTrainDiscordSettings(
  allianceId: string,
  canManage: boolean,
  canConfigureChannelSetterMinRank = false,
): Promise<TrainDiscordSettings> {
  const [announcementsEnabled, channelSetterMinRank, channels, guilds] =
    await Promise.all([
      getAllianceTrainDiscordAnnouncementsEnabled(allianceId),
      getAllianceTrainChannelSetterMinRank(allianceId),
      listGuildTrainChannelsForAlliance(allianceId),
      listAllianceDiscordGuildTrainSetup(allianceId),
    ]);
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

export function trainDiscordConfigured(settings: TrainDiscordSettings): boolean {
  return settings.announcementsEnabled && settings.guildChannelCount > 0;
}
