import "server-only";

import {
  canSetTrainChannel,
  type TrainChannelSetterMinRank,
} from "@/lib/trains/train-channel-setter.shared";
import {
  callerIsAllianceOfficerViaMemberLink,
  callerIsAllianceOwner,
  getAllianceTrainChannelSetterMinRank,
} from "@/lib/vr/repository";

export type DiscordChannelSetterDenialKey =
  | "channelSetter.deniedOwnerOnly"
  | "channelSetter.deniedOfficer";

export type DiscordChannelSetterAccess =
  | { allowed: true; minRank: TrainChannelSetterMinRank }
  | {
      allowed: false;
      minRank: TrainChannelSetterMinRank;
      denialKey: DiscordChannelSetterDenialKey;
    };

/**
 * Shared gate for every Discord `/set-*-channel` slash command.
 * Uses the alliance train-discord setting (`trainChannelSetterMinRank`):
 * R4+ by default, or R5/owner-only when the owner restricts it.
 */
export async function resolveDiscordChannelSetterAccess(input: {
  allianceId: string;
  discordUserId: string;
}): Promise<DiscordChannelSetterAccess> {
  const [minRank, isOwner, isOfficer] = await Promise.all([
    getAllianceTrainChannelSetterMinRank(input.allianceId),
    callerIsAllianceOwner({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
    }),
    callerIsAllianceOfficerViaMemberLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
    }),
  ]);

  if (canSetTrainChannel({ minRank, isOwner, isOfficer })) {
    return { allowed: true, minRank };
  }

  return {
    allowed: false,
    minRank,
    denialKey:
      minRank === "owner"
        ? "channelSetter.deniedOwnerOnly"
        : "channelSetter.deniedOfficer",
  };
}
