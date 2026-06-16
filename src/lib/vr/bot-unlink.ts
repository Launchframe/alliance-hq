import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { normalizeName } from "@/lib/vr/link-helpers";
import {
  deleteDiscordMemberLink,
  getDiscordLinkById,
  listDiscordLinksForUser,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import { resolveDiscordBotUserContext } from "@/lib/vr/bot-user-context";

export type UnlinkReply = {
  reply: string;
  picker?: Array<{ linkId: string; label: string }>;
};

export async function handleDiscordUnlinkSlash(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  memberName?: string;
}): Promise<UnlinkReply> {
  const t = createDiscordTranslator(input.locale);
  const links = await listDiscordLinksForUser(
    input.allianceId,
    input.discordUserId,
  );

  if (links.length === 0) {
    return { reply: t("unlink.none") };
  }

  const needle = input.memberName?.trim();
  if (needle) {
    const match =
      links.find(
        (row) => normalizeName(row.memberDisplayName ?? "") === normalizeName(needle),
      ) ??
      links.find((row) =>
        (row.memberDisplayName ?? "").toLowerCase().includes(needle.toLowerCase()),
      );
    if (!match) {
      return { reply: t("unlink.nameNotFound", { name: needle }) };
    }
    await deleteDiscordMemberLink(match.id);
    await auditUnlink(input, match.id, match.memberDisplayName);
    return {
      reply: t("unlink.success", {
        name: match.memberDisplayName ?? match.ashedMemberId,
      }),
    };
  }

  if (links.length === 1) {
    const only = links[0]!;
    await deleteDiscordMemberLink(only.id);
    await auditUnlink(input, only.id, only.memberDisplayName);
    return {
      reply: t("unlink.success", {
        name: only.memberDisplayName ?? only.ashedMemberId,
      }),
    };
  }

  return {
    reply: t("unlink.pickCharacter"),
    picker: links.map((row) => ({
      linkId: row.id,
      label: row.memberDisplayName ?? row.ashedMemberId,
    })),
  };
}

export async function handleDiscordUnlinkPick(input: {
  allianceId: string;
  discordUserId: string;
  linkId: string;
  locale: DiscordBotLocale;
}): Promise<UnlinkReply> {
  const t = createDiscordTranslator(input.locale);
  const link = await getDiscordLinkById(input.linkId);
  if (
    !link ||
    link.allianceId !== input.allianceId ||
    link.discordUserId !== input.discordUserId
  ) {
    return { reply: t("unlink.expired") };
  }

  await deleteDiscordMemberLink(link.id);
  await auditUnlink(input, link.id, link.memberDisplayName);
  return {
    reply: t("unlink.success", {
      name: link.memberDisplayName ?? link.ashedMemberId,
    }),
  };
}

async function auditUnlink(
  input: { allianceId: string; discordUserId: string },
  linkId: string,
  memberDisplayName: string | null,
) {
  try {
    await writeDiscordBotAudit({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      command: "unlink",
      payload: { linkId },
      result: { memberDisplayName },
    });
  } catch (error) {
    console.error("[discord-bot] unlink audit failed", error);
  }
}

export async function handleDiscordUnlinkWithContext(input: {
  guildId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  memberName?: string;
}): Promise<UnlinkReply> {
  const ctx = await resolveDiscordBotUserContext({
    guildId: input.guildId,
    discordUserId: input.discordUserId,
  });
  const t = createDiscordTranslator(input.locale);

  if (!ctx.allianceId) {
    return { reply: t("errors.guildNotRegistered") };
  }

  return handleDiscordUnlinkSlash({
    allianceId: ctx.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    memberName: input.memberName,
  });
}
