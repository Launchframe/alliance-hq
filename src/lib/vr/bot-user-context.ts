import type { DiscordMemberLink } from "@/lib/db/schema";
import { allianceHasBotCredentials } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  listDiscordLinksForUser,
  listDiscordLinksForUserAnyAlliance,
  resolveAllianceForGuild,
} from "@/lib/vr/repository";

export type DiscordBotUserContext = {
  guildId: string | null;
  allianceId: string | null;
  allianceTag: string | null;
  guildRegistered: boolean;
  hasCredentials: boolean;
  memberLinks: DiscordMemberLink[];
  memberLinkCount: number;
  isOwner: boolean;
  hasAnyMemberLink: boolean;
};

export async function resolveDiscordBotUserContext(input: {
  guildId: string | null;
  discordUserId: string;
}): Promise<DiscordBotUserContext> {
  const guildId = input.guildId?.trim() || null;
  const allianceId = guildId ? await resolveAllianceForGuild(guildId) : null;
  const guildRegistered = guildId
    ? (await getGuildAllianceId(guildId)) != null
    : false;

  const [alliance, anyLinks, memberLinks] = await Promise.all([
    allianceId ? getAllianceById(allianceId) : Promise.resolve(null),
    listDiscordLinksForUserAnyAlliance(input.discordUserId),
    allianceId
      ? listDiscordLinksForUser(allianceId, input.discordUserId)
      : Promise.resolve([]),
  ]);

  const hasCredentials = allianceId
    ? await allianceHasBotCredentials(allianceId)
    : false;
  const isOwner =
    allianceId != null
      ? await callerIsAllianceOwner({
          allianceId,
          discordUserId: input.discordUserId,
        })
      : false;

  return {
    guildId,
    allianceId,
    allianceTag: alliance?.tag ?? null,
    guildRegistered,
    hasCredentials,
    memberLinks,
    memberLinkCount: memberLinks.length,
    isOwner,
    hasAnyMemberLink: anyLinks.length > 0,
  };
}

export function pickHelpMessageKey(ctx: DiscordBotUserContext): string {
  if (!ctx.guildId) {
    return "help.dmGeneral";
  }
  if (!ctx.guildRegistered) {
    return ctx.hasAnyMemberLink ? "help.setupLinkAlliance" : "help.setupOwnerAuth";
  }
  if (!ctx.hasCredentials) {
    return ctx.isOwner ? "help.setupOwnerAuth" : "help.waitForOwnerAuth";
  }
  if (ctx.memberLinkCount === 0) {
    return "help.linkProfile";
  }
  if (ctx.isOwner) {
    return ctx.memberLinkCount > 1 ? "help.ownerReadyMulti" : "help.ownerReady";
  }
  return ctx.memberLinkCount > 1 ? "help.memberReadyMulti" : "help.memberReady";
}
