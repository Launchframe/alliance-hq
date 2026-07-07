import "server-only";

import { z } from "zod";

import {
  consumeDiscordAuthNonce,
  getValidDiscordAuthNonce,
} from "@/lib/vr/auth-nonce";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import type { DiscordMemberLinkWebOutcome } from "@/lib/vr/discord-member-link-web.shared";
import { memberLinkReplaceAllFromNonceTag } from "@/lib/vr/discord-member-link-nonce.shared";
import {
  getAllianceById,
  getDiscordUserLocale,
  getGuildAllianceId,
} from "@/lib/vr/repository";
import { resolveAllianceIdForDiscordMemberLink } from "@/lib/vr/resolve-member-link-alliance.server";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import {
  handleDiscordLinkCommanderSlash,
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkIdentityConfirm,
} from "@/lib/vr/service";

async function resolveMemberLinkContext(nonce: string) {
  const nonceRow = await getValidDiscordAuthNonce(nonce);
  if (!nonceRow || nonceRow.purpose !== "member_link") {
    return null;
  }
  if (!nonceRow.guildId) {
    return { nonceRow, allianceId: null as string | null, locale: "en-US" as DiscordBotLocale };
  }
  const allianceId = await getGuildAllianceId(nonceRow.guildId);
  const locale = (await getDiscordUserLocale(nonceRow.discordUserId)) ?? "en-US";
  return { nonceRow, allianceId, locale };
}

export async function getDiscordMemberLinkPageMeta(nonce: string) {
  const ctx = await resolveMemberLinkContext(nonce);
  if (!ctx) return null;
  const alliance = ctx.allianceId ? await getAllianceById(ctx.allianceId) : null;
  return {
    allianceTag: alliance?.tag?.toUpperCase() ?? null,
    replaceAll: memberLinkReplaceAllFromNonceTag(ctx.nonceRow.tag),
    guildRegistered: ctx.allianceId != null,
  };
}

const previewSchema = z.object({
  nonce: z.string().trim().min(1),
  gameUid: z.string().trim().min(1).max(20),
});

export async function previewDiscordMemberLinkFromWeb(
  body: z.infer<typeof previewSchema>,
): Promise<DiscordMemberLinkWebOutcome> {
  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx) {
    return {
      outcome: "error",
      message:
        "Link expired or already used. Return to Discord and run /link-commander again.",
    };
  }

  const gameUid = body.gameUid.trim();
  if (!isValidGameUid(gameUid)) {
    return {
      outcome: "error",
      message: "Enter a 12–16 digit player ID from your in-game profile.",
    };
  }

  let allianceId = ctx.allianceId;
  if (!allianceId && ctx.nonceRow.guildId) {
    const lookupForAlliance = await lookupPlayerByUid(gameUid);
    if (lookupForAlliance.ok) {
      allianceId = await resolveAllianceIdForDiscordMemberLink({
        guildId: ctx.nonceRow.guildId,
        discordUserId: ctx.nonceRow.discordUserId,
        reportedName: lookupForAlliance.gameUserName,
        gameUid,
      });
    }
  }

  if (!allianceId) {
    return {
      outcome: "error",
      message:
        "This Discord server is not registered to an alliance yet. Ask your owner to finish setup, then run /link-commander again.",
    };
  }

  const replaceAll = memberLinkReplaceAllFromNonceTag(ctx.nonceRow.tag);
  const result = await handleDiscordLinkCommanderSlash({
    allianceId,
    guildId: ctx.nonceRow.guildId,
    discordUserId: ctx.nonceRow.discordUserId,
    gameUid,
    replaceAll,
    locale: ctx.locale,
  });

  if (result.needsIdentityConfirmation && result.pending?.kind === "link_confirm_identity") {
    return {
      outcome: "confirm_identity",
      gameUserName: result.pending.gameUserName,
      gameServerNumber:
        typeof result.pending.gameServerNumber === "number"
          ? result.pending.gameServerNumber
          : null,
    };
  }

  if (result.pending?.kind === "link_fuzzy_pick") {
    return {
      outcome: "fuzzy_pick",
      message: result.reply,
      candidates: result.pending.candidates,
    };
  }

  if (result.needsOfficerAttention) {
    return { outcome: "officer_attention", message: result.reply };
  }

  if (result.linked && result.linkTarget) {
    await consumeDiscordAuthNonce(ctx.nonceRow.id);
    return {
      outcome: "linked",
      message: result.reply,
      memberDisplayName: result.linkTarget.memberDisplayName,
    };
  }

  return { outcome: "error", message: result.reply };
}

const confirmSchema = z.object({
  nonce: z.string().trim().min(1),
  answer: z.enum(["yes", "no"]),
});

export async function confirmDiscordMemberLinkFromWeb(
  body: z.infer<typeof confirmSchema>,
): Promise<DiscordMemberLinkWebOutcome> {
  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx?.allianceId) {
    return {
      outcome: "error",
      message:
        "Link expired or already used. Return to Discord and run /link-commander again.",
    };
  }

  const result = await handleDiscordLinkIdentityConfirm({
    allianceId: ctx.allianceId,
    guildId: ctx.nonceRow.guildId,
    discordUserId: ctx.nonceRow.discordUserId,
    answer: body.answer,
    locale: ctx.locale,
  });

  if (body.answer === "no") {
    return { outcome: "declined", message: result.reply };
  }

  if (result.pending?.kind === "link_fuzzy_pick") {
    return {
      outcome: "fuzzy_pick",
      message: result.reply,
      candidates: result.pending.candidates,
    };
  }

  if (result.needsOfficerAttention) {
    return { outcome: "officer_attention", message: result.reply };
  }

  if (result.linked && result.linkTarget) {
    await consumeDiscordAuthNonce(ctx.nonceRow.id);
    return {
      outcome: "linked",
      message: result.reply,
      memberDisplayName: result.linkTarget.memberDisplayName,
    };
  }

  return { outcome: "error", message: result.reply };
}

const pickSchema = z.object({
  nonce: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

export async function pickDiscordMemberLinkFromWeb(
  body: z.infer<typeof pickSchema>,
): Promise<DiscordMemberLinkWebOutcome> {
  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx?.allianceId) {
    return {
      outcome: "error",
      message:
        "Link expired or already used. Return to Discord and run /link-commander again.",
    };
  }

  const result = await handleDiscordLinkFuzzyPick({
    allianceId: ctx.allianceId,
    discordUserId: ctx.nonceRow.discordUserId,
    memberId: body.memberId,
    locale: ctx.locale,
  });

  if (result.needsOfficerAttention) {
    return { outcome: "officer_attention", message: result.reply };
  }

  if (result.linked && result.linkTarget) {
    await consumeDiscordAuthNonce(ctx.nonceRow.id);
    return {
      outcome: "linked",
      message: result.reply,
      memberDisplayName: result.linkTarget.memberDisplayName,
    };
  }

  return { outcome: "error", message: result.reply };
}

export { previewSchema, confirmSchema, pickSchema };
