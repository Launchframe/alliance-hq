import {
  createDiscordTranslator,
  setDiscordBotLocale,
  type DiscordBotLocale,
  type DiscordTranslate,
} from "@/lib/discord/i18n";
import {
  callerCanRegisterGuildAlliance,
  callerIsAllianceOwner,
  getAllianceById,
  getGuildAllianceId,
  listDiscordLinksForUser,
  saveDiscordBotPending,
  setGuildVrReportChannel,
  upsertGuildAlliance,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
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
    return {
      ok: false,
      reply: input.translate("errors.tagNotFound", { tag: input.tag.trim() }),
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
 * /link — member link via HQ web redirect (in-game name + UID; no Ashed).
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

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const authorizeUrl = `${appUrl}/discord/authorize?nonce=${nonce}`;

  return { reply: t("link.userPrompt", { url: authorizeUrl }) };
}

/**
 * /link-to-ashed-seat — secure credential setup via HQ web redirect.
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
    return { reply: t("errors.tagNotFound", { tag: "?" }) };
  }

  if (!isTagEligible(tag)) {
    return { reply: t("errors.tagNotEligible", { tag }) };
  }

  const nonce = await createDiscordAuthNonce({
    discordUserId: input.discordUserId,
    guildId: input.guildId,
    tag,
    purpose: "alliance_credentials",
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const authorizeUrl = `${appUrl}/discord/authorize?nonce=${nonce}`;

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
    const reply = t("errors.tagNotFound", { tag: "?" });
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
    const reply =
      registration.reason === "no_credentials"
        ? t("errors.credentialsRequired", { tag: resolved.tag })
        : registration.reason === "not_owner" || registration.reason === "no_hq_link"
          ? t("errors.notOwner")
          : t("errors.notOwner");
    await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
      reply,
      registration,
    });
    return { reply };
  }

  await upsertGuildAlliance(input.guildId, resolved.allianceId);
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

  const isOwner = await callerIsAllianceOwner({
    allianceId: registeredAllianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    const reply = t("errors.notOwner");
    await audit(
      registeredAllianceId,
      input.discordUserId,
      "set_vr_report_channel",
      input,
      { reply },
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

/** Post-HQ-auth hint when guild is registered but user has no commanders linked. */
export async function buildFirstCommanderPrompt(input: {
  guildId: string | null;
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<string | null> {
  if (!input.guildId || !input.allianceId) return null;
  const registered = await getGuildAllianceId(input.guildId);
  if (registered !== input.allianceId) return null;
  const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
  if (links.length > 0) return null;
  const t = createDiscordTranslator(input.locale);
  return t("link.promptFirstCommander");
}
