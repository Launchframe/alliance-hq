import "server-only";

import { z } from "zod";

import {
  assertDiscordMemberLinkWebSession,
  type DiscordMemberLinkWebSessionDenyReason,
} from "@/lib/auth/discord-member-link-gate.server";
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
  getDiscordBotPending,
  getDiscordUserLocale,
  getGuildAllianceId,
} from "@/lib/vr/repository";
import { resolveAllianceIdForDiscordMemberLink } from "@/lib/vr/resolve-member-link-alliance.server";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import type { LinkCommandResult } from "@/lib/vr/types";
import {
  handleDiscordLinkCommanderSlash,
  handleDiscordLinkFuzzyPick,
  handleDiscordLinkIdentityConfirm,
} from "@/lib/vr/service";

const SESSION_DENY_MESSAGES: Record<DiscordMemberLinkWebSessionDenyReason, string> = {
  invalid_nonce:
    "Link expired or already used. Return to Discord and run /link-commander again.",
  not_signed_in: "Sign in to continue linking your commander.",
  discord_mismatch:
    "This Alliance HQ account is linked to a different Discord user. Sign in with the same Discord account that ran /link-commander in your server.",
  needs_join_code: "Redeem your alliance join code before linking your commander.",
};

type MemberLinkContext = {
  nonceRow: NonNullable<Awaited<ReturnType<typeof getValidDiscordAuthNonce>>>;
  allianceId: string | null;
  locale: DiscordBotLocale;
};

async function resolveMemberLinkContext(nonce: string): Promise<MemberLinkContext | null> {
  const nonceRow = await getValidDiscordAuthNonce(nonce);
  if (!nonceRow || nonceRow.purpose !== "member_link") {
    return null;
  }
  if (!nonceRow.guildId) {
    return { nonceRow, allianceId: null, locale: "en-US" };
  }
  const allianceId = await getGuildAllianceId(nonceRow.guildId);
  const locale = (await getDiscordUserLocale(nonceRow.discordUserId)) ?? "en-US";
  return { nonceRow, allianceId, locale };
}

async function resolveMemberLinkAllianceId(
  ctx: MemberLinkContext,
  options?: { gameUid?: string; pendingFallback?: boolean },
): Promise<string | null> {
  if (ctx.allianceId) return ctx.allianceId;

  const gameUid = options?.gameUid?.trim();
  if (gameUid && ctx.nonceRow.guildId) {
    const lookup = await lookupPlayerByUid(gameUid);
    if (lookup.ok) {
      const resolved = await resolveAllianceIdForDiscordMemberLink({
        guildId: ctx.nonceRow.guildId,
        discordUserId: ctx.nonceRow.discordUserId,
        reportedName: lookup.gameUserName,
        gameUid,
      });
      if (resolved) return resolved;
    }
  }

  if (options?.pendingFallback) {
    const pendingRow = await getDiscordBotPending(ctx.nonceRow.discordUserId);
    return pendingRow?.allianceId ?? null;
  }

  return null;
}

function sessionDenyOutcome(
  reason: DiscordMemberLinkWebSessionDenyReason,
): DiscordMemberLinkWebOutcome {
  return { outcome: "error", message: SESSION_DENY_MESSAGES[reason] };
}

async function requireAuthenticatedMemberLinkSession(
  nonce: string,
  hqUserId: string | null,
): Promise<DiscordMemberLinkWebOutcome | null> {
  const session = await assertDiscordMemberLinkWebSession({ nonce, hqUserId });
  if (!session.ok) {
    return sessionDenyOutcome(session.reason);
  }
  return null;
}

async function mapLinkCommandResultToWebOutcome(
  result: LinkCommandResult,
  consumeNonceOnLink: { nonceId: string; linked: boolean },
): Promise<DiscordMemberLinkWebOutcome> {
  if (result.wrongServer) {
    return { outcome: "wrong_server", message: result.reply };
  }

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
    if (consumeNonceOnLink.linked) {
      await consumeDiscordAuthNonce(consumeNonceOnLink.nonceId);
    }
    return {
      outcome: "linked",
      message: result.reply,
      memberDisplayName: result.linkTarget.memberDisplayName,
    };
  }

  return { outcome: "error", message: result.reply };
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
  hqUserId: string | null,
): Promise<DiscordMemberLinkWebOutcome> {
  const denied = await requireAuthenticatedMemberLinkSession(body.nonce, hqUserId);
  if (denied) return denied;

  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx) {
    return sessionDenyOutcome("invalid_nonce");
  }

  const gameUid = body.gameUid.trim();
  if (!isValidGameUid(gameUid)) {
    return {
      outcome: "error",
      message: "Enter a 12–16 digit player ID from your in-game profile.",
    };
  }

  const allianceId = await resolveMemberLinkAllianceId(ctx, { gameUid });

  if (!allianceId) {
    return { outcome: "guild_not_registered" };
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

  return await mapLinkCommandResultToWebOutcome(result, {
    nonceId: ctx.nonceRow.id,
    linked: Boolean(result.linked && result.linkTarget),
  });
}

const confirmSchema = z.object({
  nonce: z.string().trim().min(1),
  answer: z.enum(["yes", "no"]),
});

export async function confirmDiscordMemberLinkFromWeb(
  body: z.infer<typeof confirmSchema>,
  hqUserId: string | null,
): Promise<DiscordMemberLinkWebOutcome> {
  const denied = await requireAuthenticatedMemberLinkSession(body.nonce, hqUserId);
  if (denied) return denied;

  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx) {
    return sessionDenyOutcome("invalid_nonce");
  }

  const allianceId = await resolveMemberLinkAllianceId(ctx, { pendingFallback: true });
  if (!allianceId) {
    return { outcome: "guild_not_registered" };
  }

  const result = await handleDiscordLinkIdentityConfirm({
    allianceId,
    guildId: ctx.nonceRow.guildId,
    discordUserId: ctx.nonceRow.discordUserId,
    answer: body.answer,
    locale: ctx.locale,
  });

  if (body.answer === "no") {
    return { outcome: "declined", message: result.reply };
  }

  return await mapLinkCommandResultToWebOutcome(result, {
    nonceId: ctx.nonceRow.id,
    linked: Boolean(result.linked && result.linkTarget),
  });
}

const pickSchema = z.object({
  nonce: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

export async function pickDiscordMemberLinkFromWeb(
  body: z.infer<typeof pickSchema>,
  hqUserId: string | null,
): Promise<DiscordMemberLinkWebOutcome> {
  const denied = await requireAuthenticatedMemberLinkSession(body.nonce, hqUserId);
  if (denied) return denied;

  const ctx = await resolveMemberLinkContext(body.nonce);
  if (!ctx) {
    return sessionDenyOutcome("invalid_nonce");
  }

  const allianceId = await resolveMemberLinkAllianceId(ctx, { pendingFallback: true });
  if (!allianceId) {
    return { outcome: "guild_not_registered" };
  }

  const result = await handleDiscordLinkFuzzyPick({
    allianceId,
    discordUserId: ctx.nonceRow.discordUserId,
    memberId: body.memberId,
    locale: ctx.locale,
  });

  return await mapLinkCommandResultToWebOutcome(result, {
    nonceId: ctx.nonceRow.id,
    linked: Boolean(result.linked && result.linkTarget),
  });
}

export { previewSchema, confirmSchema, pickSchema };
