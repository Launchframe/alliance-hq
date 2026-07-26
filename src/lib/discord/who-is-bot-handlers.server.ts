import "server-only";

import { discordBotAppOrigin } from "@/lib/discord/app-url.shared";
import { callerCanIssueClaimInviteFromDiscord } from "@/lib/discord/claim-invite-auth.server";
import {
  createDiscordTranslator,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { getHqMemberLinkByAllianceAndMember } from "@/lib/member-link/repository.server";
import { CommanderClaimInviteError } from "@/lib/native-alliance/invites";
import {
  buildJoinCodeSharePayload,
  loadAllianceInviteShareContext,
} from "@/lib/native-alliance/invite-share-payload.server";
import { createAllianceJoinCode } from "@/lib/native-alliance/join-codes";
import { findFuzzyMemberCandidates } from "@/lib/video/member-matcher";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import { findExactMemberByName } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getAllianceById,
  getDiscordLinkByAllianceAndMember,
  getLinkedMemberIds,
  listDiscordLinksForUser,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";

export type WhoIsBotReply = {
  reply: string;
  pickCandidates?: Array<{ memberId: string; name: string }>;
  claimInvite?: { ashedMemberId: string; commanderName: string };
};

async function auditWhoIs(
  allianceId: string,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
  await writeDiscordBotAudit({
    allianceId,
    discordUserId,
    command,
    payload,
    result,
  });
}

async function ensureCallerLinked(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<WhoIsBotReply | null> {
  const t = createDiscordTranslator(input.locale);
  const callerLinks = await listDiscordLinksForStatusQuery(
    input.allianceId,
    input.discordUserId,
  );
  if (callerLinks.length === 0) {
    const reply = t("whoIs.notLinked");
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
    });
    return { reply };
  }
  return null;
}

async function lookupByDiscordUser(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  targetDiscordUserId: string;
}): Promise<WhoIsBotReply> {
  const t = createDiscordTranslator(input.locale);
  const mention = `<@${input.targetDiscordUserId}>`;
  const links = await listDiscordLinksForUser(
    input.allianceId,
    input.targetDiscordUserId,
  );

  if (links.length === 0) {
    const reply = t("whoIs.discordNoCommander", { mention });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
    });
    return { reply };
  }

  const commanderNames = links
    .map((link) => link.memberDisplayName?.trim())
    .filter((name): name is string => Boolean(name));
  const reply = t("whoIs.discordResult", {
    mention,
    commanders: commanderNames.join(", "),
  });
  await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
    reply,
    commanderCount: links.length,
  });
  return { reply };
}

async function resolveRosterMember(input: {
  allianceId: string;
  commanderName?: string;
  resolvedMemberId?: string;
}): Promise<
  | { ok: true; memberId: string; memberName: string }
  | { ok: false; notFound?: true; pickCandidates?: Array<{ memberId: string; name: string }> }
> {
  const members = await loadAllianceMembersForBot(input.allianceId);

  if (input.resolvedMemberId) {
    const member = members.find((row) => row.id === input.resolvedMemberId);
    if (!member) return { ok: false, notFound: true };
    return { ok: true, memberId: member.id, memberName: member.current_name };
  }

  const name = input.commanderName?.trim();
  if (!name) return { ok: false, notFound: true };

  const exact = findExactMemberByName(members, name);
  if (exact) {
    return { ok: true, memberId: exact.id, memberName: exact.current_name };
  }

  const alliance = await getAllianceById(input.allianceId);
  const candidates = findFuzzyMemberCandidates(name, members, {
    allianceTag: alliance?.tag,
    limit: 5,
  });
  if (candidates.length === 0) return { ok: false, notFound: true };
  if (candidates.length > 1) {
    return {
      ok: false,
      pickCandidates: candidates.map((candidate) => ({
        memberId: candidate.memberId,
        name: candidate.name,
      })),
    };
  }

  return {
    ok: true,
    memberId: candidates[0]!.memberId,
    memberName: candidates[0]!.name,
  };
}

async function lookupByCommander(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  commanderName?: string;
  resolvedMemberId?: string;
}): Promise<WhoIsBotReply> {
  const t = createDiscordTranslator(input.locale);
  const resolved = await resolveRosterMember({
    allianceId: input.allianceId,
    commanderName: input.commanderName,
    resolvedMemberId: input.resolvedMemberId,
  });

  if (!resolved.ok) {
    if (resolved.pickCandidates?.length) {
      const reply = t("whoIs.pickCommander", {
        names: resolved.pickCandidates.map((row) => row.name).join(", "),
      });
      await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
        reply,
        pickCount: resolved.pickCandidates.length,
      });
      return { reply, pickCandidates: resolved.pickCandidates };
    }
    if (resolved.notFound && input.resolvedMemberId) {
      const reply = t("whoIs.pickExpired");
      await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
        reply,
        stalePick: true,
      });
      return { reply };
    }
    const reply = t("whoIs.commanderNotFound", {
      name: input.commanderName?.trim() ?? "",
    });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
    });
    return { reply };
  }

  const { memberId, memberName } = resolved;
  const discordLink = await getDiscordLinkByAllianceAndMember(
    input.allianceId,
    memberId,
  );
  if (discordLink) {
    const handle =
      discordLink.discordUsername?.trim() ||
      `<@${discordLink.discordUserId}>`;
    const reply = t("whoIs.commanderOwner", {
      name: memberName,
      mention: `<@${discordLink.discordUserId}>`,
      handle,
    });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
      ashedMemberId: memberId,
    });
    return { reply };
  }

  const hqLink = await getHqMemberLinkByAllianceAndMember(
    input.allianceId,
    memberId,
  );
  if (hqLink) {
    const reply = t("whoIs.commanderHqOnly", { name: memberName });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
      ashedMemberId: memberId,
    });
    return { reply };
  }

  const linkedMemberIds = await getLinkedMemberIds(input.allianceId);
  if (linkedMemberIds.has(memberId)) {
    const reply = t("whoIs.commanderHqOnly", { name: memberName });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
      ashedMemberId: memberId,
    });
    return { reply };
  }

  const canInvite = await callerCanIssueClaimInviteFromDiscord({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (canInvite) {
    const reply = t("whoIs.unclaimedOfficer", { name: memberName });
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
      ashedMemberId: memberId,
      claimInviteOffered: true,
    });
    return {
      reply,
      claimInvite: { ashedMemberId: memberId, commanderName: memberName },
    };
  }

  const reply = t("whoIs.unclaimedMember", { name: memberName });
  await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
    reply,
    ashedMemberId: memberId,
  });
  return { reply };
}

export async function handleDiscordWhoIs(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  targetDiscordUserId?: string;
  commanderName?: string;
  resolvedMemberId?: string;
}): Promise<WhoIsBotReply> {
  const t = createDiscordTranslator(input.locale);
  const denied = await ensureCallerLinked(input);
  if (denied) return denied;

  const hasDiscord = Boolean(input.targetDiscordUserId?.trim());
  const hasCommander = Boolean(
    input.resolvedMemberId || input.commanderName?.trim(),
  );

  if (hasDiscord === hasCommander) {
    const reply = t("whoIs.usage");
    await auditWhoIs(input.allianceId, input.discordUserId, "who_is", input, {
      reply,
    });
    return { reply };
  }

  if (hasDiscord) {
    return lookupByDiscordUser({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      targetDiscordUserId: input.targetDiscordUserId!.trim(),
    });
  }

  return lookupByCommander(input);
}

export async function handleDiscordWhoIsClaimInvite(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  ashedMemberId: string;
}): Promise<{ reply: string }> {
  const t = createDiscordTranslator(input.locale);
  const denied = await ensureCallerLinked(input);
  if (denied) return denied;

  const canInvite = await callerCanIssueClaimInviteFromDiscord({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!canInvite) {
    const reply = t("whoIs.claimInviteDenied");
    await auditWhoIs(
      input.allianceId,
      input.discordUserId,
      "who_is_claim_invite",
      input,
      { reply, denied: true },
    );
    return { reply };
  }

  try {
    const joinCode = await createAllianceJoinCode({
      allianceId: input.allianceId,
      roleName: "member",
      maxRedemptions: 1,
      targetAshedMemberId: input.ashedMemberId,
    });
    const alliance = await loadAllianceInviteShareContext(input.allianceId);
    const share = buildJoinCodeSharePayload({
      origin: discordBotAppOrigin(),
      allianceName: alliance.allianceName,
      allianceTag: alliance.allianceTag,
      code: joinCode.code,
      variant: "claim_code",
    });
    const reply = t("whoIs.claimInviteCreated", {
      name: joinCode.targetCommanderName ?? "",
      code: joinCode.code,
      shareMessage: share.shareMessage,
    });
    await auditWhoIs(
      input.allianceId,
      input.discordUserId,
      "who_is_claim_invite",
      input,
      { reply, joinCodeId: joinCode.joinCodeId },
    );
    return { reply };
  } catch (error) {
    if (error instanceof CommanderClaimInviteError) {
      const reply = t("whoIs.claimInviteFailed", { reason: error.message });
      await auditWhoIs(
        input.allianceId,
        input.discordUserId,
        "who_is_claim_invite",
        input,
        { reply, error: error.code },
      );
      return { reply };
    }
    const reply = t("errors.serverError");
    await auditWhoIs(
      input.allianceId,
      input.discordUserId,
      "who_is_claim_invite",
      input,
      { reply, error: "unexpected" },
    );
    return { reply };
  }
}
