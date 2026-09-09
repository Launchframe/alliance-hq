import {
  createDiscordTranslator,
  setDiscordBotLocale,
  type DiscordBotLocale,
  type DiscordTranslate,
} from "@/lib/discord/i18n";
import { resolveDiscordChannelSetterAccess } from "@/lib/discord/channel-setter-auth.server";
import {
  bindGuildAllianceForRegistration,
  callerCanRegisterGuildAlliance,
  getAllianceById,
  getDiscordHqLink,
  getGuildAllianceId,
  saveDiscordBotPending,
  setGuildVrReportChannel,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { resolveAllianceByTag } from "@/lib/vr/resolve-alliance-tag";
import { createDiscordAuthNonce } from "@/lib/vr/auth-nonce";
import type { LinkPendingState } from "@/lib/vr/types";

export type BotReply = { reply: string };

/** Returns true when the tag is permitted to use bot setup commands.
 *  When ELIGIBLE_BOT_ALLIANCE_LINK_TAGS is unset every tag is allowed.
 *  When set, only comma-separated tags in the list may proceed. */
export function isTagEligible(tag: string): boolean {
  const raw = process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS;
  if (!raw?.trim()) return true;
  const allowed = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(tag.trim().toLowerCase());
}

/** Case-insensitive alliance tag equality for bot-install allowlist binding. */
export function allianceTagsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function audit(
  allianceId: string | null,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
  if (!allianceId) return;
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload,
      result,
    });
  } catch (error) {
    console.error("[discord-bot] audit log failed", error);
  }
}

async function resolveTagForSetup(input: {
  tag: string;
  discordUserId: string;
  allianceName?: string;
  locale: DiscordBotLocale;
  translate: DiscordTranslate;
}): Promise<
  | { ok: true; allianceId: string; tag: string; name: string }
  | { ok: false; reply: string; pending?: LinkPendingState | null }
> {
  const resolved = await resolveAllianceByTag(input.tag, {
    discordUserId: input.discordUserId,
    allianceName: input.allianceName,
  });

  if (resolved.ok) {
    return {
      ok: true,
      allianceId: resolved.alliance.id,
      tag: resolved.alliance.tag,
      name: resolved.alliance.name,
    };
  }

  if (resolved.reason === "not_found") {
    const hqLink = await getDiscordHqLink(input.discordUserId);
    const appUrl = buildDiscordBotAppUrl(input.locale, "/");
    return {
      ok: false,
      reply: hqLink
        ? input.translate("errors.tagNotFoundWithHq", {
            tag: input.tag.trim(),
          })
        : input.translate("errors.tagNotFoundNoHq", {
            tag: input.tag.trim(),
            appUrl,
          }),
    };
  }

  const pending: LinkPendingState = {
    kind: "pick_alliance_by_name",
    tag: input.tag.trim(),
    candidates: (resolved.candidates ?? []).map((c) => ({
      allianceId: c.id,
      name: c.name,
      tag: c.tag,
    })),
  };

  return {
    ok: false,
    reply: input.translate("errors.tagAmbiguous", { tag: input.tag.trim() }),
    pending,
  };
}

/**
 * /link — Discord ↔ Alliance HQ account via browser OAuth (no alliance required).
 */
export async function handleDiscordLinkUser(input: {
  guildId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);

  const nonce = await createDiscordAuthNonce({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    purpose: "user_link",
  });

  const authorizeUrl = buildDiscordBotAppUrl(
    input.locale,
    `/discord/authorize?nonce=${nonce}`,
  );

  return { reply: t("link.userPrompt", { url: authorizeUrl }) };
}

/**
 * /link-ashed — secure Ashed credential setup via HQ web redirect.
 *
 * When the tag already exists in HQ, only the alliance owner, credential
 * registrant, or platform maintainer may start this flow (not R4 officers).
 * When the tag is not in HQ yet (Ashed-first bootstrap), any HQ-linked user may
 * open the authorize URL; the authorize handler still requires an Ashed
 * **owner** connection key before credentials are stored.
 */
export async function handleDiscordLinkToAshedSeat(input: {
  guildId: string;
  discordUserId: string;
  tag: string;
  allianceName?: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const tag = input.tag?.trim();

  if (!tag) {
    return { reply: t("errors.tagRequired") };
  }

  if (!isTagEligible(tag)) {
    return { reply: t("errors.tagNotEligible", { tag }) };
  }

  const hqLink = await getDiscordHqLink(input.discordUserId);
  if (!hqLink) {
    return {
      reply: t("errors.linkHqFirst", { tag }),
    };
  }

  const allianceName = input.allianceName?.trim();
  // Resolve directly so we can allow Ashed-first bootstrap on `not_found`
  // while still gating existing HQ alliances to owner/maintainer/registrant.
  const resolved = await resolveAllianceByTag(tag, {
    discordUserId: input.discordUserId,
    allianceName,
  });

  if (resolved.ok) {
    const registration = await callerCanRegisterGuildAlliance({
      allianceId: resolved.alliance.id,
      discordUserId: input.discordUserId,
    });
    if (!registration.allowed) {
      return {
        reply:
          registration.reason === "no_credentials"
            ? t("errors.linkAllianceNeedCommander", { tag: resolved.alliance.tag })
            : t("errors.linkAshedOwnerOnly", { tag: resolved.alliance.tag }),
      };
    }
    // Officers may `/link-alliance` but must not install/overwrite Ashed bot JWTs.
    if (registration.registeredBy === "alliance_officer") {
      return {
        reply: t("errors.linkAshedOwnerOnly", { tag: resolved.alliance.tag }),
      };
    }
  } else if (resolved.reason === "ambiguous") {
    return {
      reply: t("errors.tagAmbiguous", { tag }),
    };
  }
  // reason === "not_found": Ashed-first bootstrap — authorize still requires
  // an Ashed owner connection key before credentials are stored.

  const nonce = await createDiscordAuthNonce({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    tag,
    purpose: "alliance_credentials",
  });

  const authorizeUrl = buildDiscordBotAppUrl(
    input.locale,
    `/discord/authorize?nonce=${nonce}`,
  );

  return { reply: t("setup.linkAshedSeatPrompt", { tag, url: authorizeUrl }) };
}


export async function handleDiscordLinkAlliance(input: {
  guildId: string;
  discordUserId: string;
  tag: string;
  allianceName?: string;
  locale: DiscordBotLocale;
}): Promise<BotReply & { pending?: LinkPendingState | null }> {
  const t = createDiscordTranslator(input.locale);
  const tag = input.tag?.trim();
  if (!tag) {
    const reply = t("errors.tagRequired");
    await audit(null, input.discordUserId, "link_alliance", input, { reply });
    return { reply };
  }

  if (!isTagEligible(tag)) {
    const reply = t("errors.tagNotEligible", { tag });
    await audit(null, input.discordUserId, "link_alliance", input, { reply });
    return { reply };
  }

  const allianceName = input.allianceName?.trim();

  const resolved = await resolveTagForSetup({
    tag,
    discordUserId: input.discordUserId,
    allianceName,
    locale: input.locale,
    translate: t,
  });

  if (!resolved.ok) {
    if (resolved.pending?.kind === "pick_alliance_by_name") {
      const fallbackAllianceId = resolved.pending.candidates[0]?.allianceId;
      if (fallbackAllianceId) {
        await saveDiscordBotPending(
          fallbackAllianceId,
          input.discordUserId,
          resolved.pending,
        );
      }
    }
    await audit(null, input.discordUserId, "link_alliance", input, resolved);
    return { reply: resolved.reply, pending: resolved.pending ?? null };
  }

  const registration = await callerCanRegisterGuildAlliance({
    allianceId: resolved.allianceId,
    discordUserId: input.discordUserId,
  });

  if (!registration.allowed) {
    const hqLink = await getDiscordHqLink(input.discordUserId);
    const reply =
      registration.reason === "no_credentials"
        ? hqLink
          ? t("errors.linkAllianceNeedCommander", { tag: resolved.tag })
          : t("errors.linkHqFirst", { tag: resolved.tag })
        : registration.reason === "not_owner" || registration.reason === "no_hq_link"
          ? t("errors.notOwner")
          : t("errors.notOwner");
    await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
      reply,
      registration,
    });
    return { reply };
  }

  const bind = await bindGuildAllianceForRegistration({
    guildId: input.guildId,
    allianceId: resolved.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!bind.ok) {
    const reply = t("errors.guildLinkedToOtherAlliance");
    await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
      reply,
      bind,
    });
    return { reply };
  }

  await saveDiscordBotPending(resolved.allianceId, input.discordUserId, null);

  const reply = t("setup.linkAllianceSuccess", { tag: resolved.tag });
  await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
    reply,
    registeredBy: registration.registeredBy,
  });
  return { reply };
}

export async function handleDiscordSetVrReportChannel(input: {
  guildId: string;
  channelId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const registeredAllianceId = await getGuildAllianceId(input.guildId);
  if (!registeredAllianceId) {
    const reply = t("errors.guildNotRegistered");
    await audit(null, input.discordUserId, "set_vr_report_channel", input, {
      reply,
    });
    return { reply };
  }

  const access = await resolveDiscordChannelSetterAccess({
    allianceId: registeredAllianceId,
    discordUserId: input.discordUserId,
  });
  if (!access.allowed) {
    const reply = t(access.denialKey);
    await audit(
      registeredAllianceId,
      input.discordUserId,
      "set_vr_report_channel",
      input,
      { reply, minRank: access.minRank },
    );
    return { reply };
  }

  await setGuildVrReportChannel(input.guildId, input.channelId);
  const alliance = await getAllianceById(registeredAllianceId);
  const reply = t("setVrReportChannel.success", {
    tag: alliance?.tag ?? "?",
    channel: `<#${input.channelId}>`,
  });
  await audit(
    registeredAllianceId,
    input.discordUserId,
    "set_vr_report_channel",
    input,
    { reply },
  );
  return { reply };
}

export async function handleDiscordLanguage(input: {
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  await setDiscordBotLocale(input.discordUserId, input.locale);
  const t = createDiscordTranslator(input.locale);
  return { reply: t("setup.languageSuccess") };
}
