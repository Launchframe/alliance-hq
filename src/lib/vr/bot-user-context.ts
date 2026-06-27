import type { DiscordMemberLink } from "@/lib/db/schema";
import {
  createDiscordTranslator,
  type DiscordBotLocale,
  type DiscordTranslate,
} from "@/lib/discord/i18n";
import { allianceHasBotCredentials } from "@/lib/vr/member-roster";
import {
  callerIsAllianceOwner,
  callerIsPlatformMaintainerViaDiscord,
  getAllianceById,
  getDiscordHqLink,
  getGuildAllianceId,
  listDiscordLinksForUser,
  listDiscordLinksForUserAnyAlliance,
  resolveAllianceForGuild,
  userRegisteredAllianceCredentials,
} from "@/lib/vr/repository";

export type DiscordBotUserContext = {
  guildId: string | null;
  allianceId: string | null;
  allianceTag: string | null;
  guildRegistered: boolean;
  hasCredentials: boolean;
  hasHqLink: boolean;
  isPlatformMaintainer: boolean;
  userRegisteredCredentials: boolean;
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

  const [alliance, hqLink, userRegisteredCredentials, isPlatformMaintainer, anyLinks, memberLinks] =
    await Promise.all([
      allianceId ? getAllianceById(allianceId) : Promise.resolve(null),
      getDiscordHqLink(input.discordUserId),
      userRegisteredAllianceCredentials(input.discordUserId),
      callerIsPlatformMaintainerViaDiscord(input.discordUserId),
      listDiscordLinksForUserAnyAlliance(input.discordUserId),
      allianceId
        ? listDiscordLinksForUser(allianceId, input.discordUserId)
        : Promise.resolve([]),
    ]);

  const hasCredentials = allianceId
    ? await allianceHasBotCredentials(allianceId)
    : userRegisteredCredentials;
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
    hasHqLink: hqLink != null,
    isPlatformMaintainer,
    userRegisteredCredentials,
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
    if (ctx.isPlatformMaintainer || ctx.userRegisteredCredentials) {
      return "help.setupLinkAlliance";
    }
    if (!ctx.hasHqLink) {
      return "help.setupOwnerLinkHq";
    }
    return "help.setupOwnerAshedSeat";
  }
  if (ctx.memberLinkCount === 0) {
    return "help.linkCommander";
  }
  if (ctx.isOwner) {
    return ctx.memberLinkCount > 1 ? "help.ownerReadyMulti" : "help.ownerReady";
  }
  return ctx.memberLinkCount > 1 ? "help.memberReadyMulti" : "help.memberReady";
}

export function discordAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

export function formatHelpReply(
  t: DiscordTranslate,
  key: string,
  ctx: DiscordBotUserContext,
): string {
  return t(key, {
    tag: ctx.allianceTag ?? "YourTag",
    count: ctx.memberLinkCount,
    appUrl: discordAppBaseUrl(),
  });
}

export async function resolveSetupMessage(
  locale: DiscordBotLocale,
  guildId: string | null,
  discordUserId: string,
): Promise<string> {
  const ctx = await resolveDiscordBotUserContext({ guildId, discordUserId });
  const t = createDiscordTranslator(locale);
  return formatHelpReply(t, pickHelpMessageKey(ctx), ctx);
}
