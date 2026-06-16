import type { DiscordMemberLink } from "@/lib/db/schema";
import { allianceHasBotCredentials } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  listDiscordLinksForUser,
  listDiscordLinksForUserAnyAlliance,
  resolveAllianceForGuild,
  resolveOwnerSetupAllianceId,
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

  const setupAllianceId =
    guildId && !guildRegistered && input.discordUserId
      ? await resolveOwnerSetupAllianceId(guildId, input.discordUserId)
      : null;
  const effectiveAllianceId = allianceId ?? setupAllianceId;

  const [alliance, anyLinks, memberLinks] = await Promise.all([
    effectiveAllianceId ? getAllianceById(effectiveAllianceId) : Promise.resolve(null),
    listDiscordLinksForUserAnyAlliance(input.discordUserId),
    effectiveAllianceId
      ? listDiscordLinksForUser(effectiveAllianceId, input.discordUserId)
      : Promise.resolve([]),
  ]);

  const hasCredentials = effectiveAllianceId
    ? await allianceHasBotCredentials(effectiveAllianceId)
    : false;
  const isOwner =
    effectiveAllianceId != null
      ? await callerIsAllianceOwner({
          allianceId: effectiveAllianceId,
          discordUserId: input.discordUserId,
        })
      : false;

  return {
    guildId,
    allianceId: effectiveAllianceId,
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
    if (ctx.hasCredentials) {
      return ctx.memberLinkCount > 0
        ? "help.setupLinkAlliance"
        : "help.setupOwnerLinkAfterAuth";
    }
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
