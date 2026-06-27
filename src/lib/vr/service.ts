import { emitAdminAlert } from "@/lib/events/admin-alerts";
import {
  createDiscordTranslator,
  tStringArray,
  type DiscordBotLocale,
} from "@/lib/discord/i18n";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { resolveMaxBaseVrForAlliance } from "@/lib/game-season/game-servers.server";
import { peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { MAX_DISCORD_LINKS_PER_USER } from "@/lib/vr/constants";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import {
  processLinkCommand,
  processLinkFuzzyPick,
} from "@/lib/vr/link-command";
import {
  advanceLinkWalkthrough,
  findUniqueSubstringRosterCandidate,
  walkthroughMessage,
} from "@/lib/vr/link-helpers";
import { createDiscordRosterMissLinkRequest } from "@/lib/member-link/roster-link-request.server";
import {
  loadAllianceMembersForBot,
  loadAllianceMembersForMemberLinkWithLiveRetry,
} from "@/lib/vr/member-roster";
import {
  countSeasonReporters,
  getAllianceById,
  getDiscordBotPending,
  getDiscordHqLink,
  getDiscordLinkById,
  getGuildAllianceId,
  getLinkedMemberIds,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  listSeasonVrRows,
  linkDiscordMember,
  maybeClaimNativeOwnerFromDiscordLink,
  resolveSeasonKey,
  saveDiscordBotPending,
  upsertMemberSeasonVr,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import type { LinkCommandResult, LinkPendingState, VrCommandResult, VrPendingState } from "@/lib/vr/types";

export {
  handleDiscordHelp,
} from "@/lib/vr/bot-help";
export {
  handleDiscordUnlinkPick,
  handleDiscordUnlinkWithContext,
} from "@/lib/vr/bot-unlink";
export {
  handleDiscordLanguage,
  handleDiscordLinkAlliance,
  handleDiscordLinkToAshedSeat,
  handleDiscordLinkUser,
  handleDiscordSetVrReportChannel,
} from "@/lib/vr/bot-setup";
export { handleDiscordVrReport } from "@/lib/vr/bot-vr-report";
export { resolveDiscordAllianceId, resolveAllianceForGuild } from "@/lib/vr/repository";

async function audit(
  allianceId: string,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
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

function botContext(locale: DiscordBotLocale) {
  const translate = createDiscordTranslator(locale);
  const walkthroughSteps = tStringArray(locale, "link.steps");
  return { translate, walkthroughSteps };
}

function linkSuccessReply(
  translate: ReturnType<typeof createDiscordTranslator>,
  mode: "created" | "updated" | "replaced",
  name: string,
  hadExistingLinks: boolean,
  replaceAll?: boolean,
): string {
  if (mode === "replaced" || replaceAll) {
    return translate("link.replaced", { name });
  }
  if (mode === "updated") {
    return translate("link.updated", { name });
  }
  if (hadExistingLinks) {
    return translate("link.linkedAdditional", { name });
  }
  return translate("link.linked", { name });
}

async function persistLinkTarget(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string;
  linkTarget: {
    ashedMemberId: string;
    memberDisplayName: string;
    gameUid: string;
    gameUserLevel?: number;
  };
  replaceAll?: boolean;
  translate: ReturnType<typeof createDiscordTranslator>;
}): Promise<LinkCommandResult> {
  const existingLinks = await listDiscordLinksForUser(
    input.allianceId,
    input.discordUserId,
  );
  const linked = await linkDiscordMember({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    ashedMemberId: input.linkTarget.ashedMemberId,
    memberDisplayName: input.linkTarget.memberDisplayName,
    gameUid: input.linkTarget.gameUid,
    replaceAll: input.replaceAll,
  });

  if (!linked.ok) {
    if (linked.reason === "cap_reached") {
      return {
        reply: input.translate("link.capReached", {
          max: MAX_DISCORD_LINKS_PER_USER,
        }),
        pending: null,
      };
    }
    return {
      reply: input.translate("link.memberTaken"),
      pending: null,
    };
  }

  if (input.linkTarget.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: input.allianceId,
        ashedMemberId: input.linkTarget.ashedMemberId,
        gameUserLevel: input.linkTarget.gameUserLevel,
      });
    } catch (error) {
      console.error("[discord-bot] member level sync failed", error);
    }
  }

  // Conservatively claim native-alliance ownership when this link is the sole
  // active R5 and no owner is recorded yet, so a Discord-only owner can later
  // register the guild without completing HQ-web onboarding first. No-op for
  // Ashed-sourced alliances or when ownership is ambiguous/already set.
  try {
    await maybeClaimNativeOwnerFromDiscordLink({
      allianceId: input.allianceId,
      ashedMemberId: input.linkTarget.ashedMemberId,
    });
  } catch (error) {
    console.error("[discord-bot] native owner claim failed", error);
  }

  return {
    reply: linkSuccessReply(
      input.translate,
      linked.mode,
      input.linkTarget.memberDisplayName,
      existingLinks.length > 0,
      input.replaceAll,
    ),
    pending: null,
    linked: true,
    linkTarget: input.linkTarget,
  };
}

export async function handleDiscordLinkCommanderSlash(input: {
  allianceId: string;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  reportedName?: string;
  gameUid?: string;
  replaceAll?: boolean;
  locale: DiscordBotLocale;
}): Promise<LinkCommandResult> {
  const { translate, walkthroughSteps } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending ?? null;

  const name = input.reportedName?.trim();
  const uid = input.gameUid?.trim();

  if (pending?.kind === "link_walkthrough" && !name && !uid) {
    const result = processLinkCommand({
      reportedName: "",
      gameUid: "",
      lookup: { ok: false, reason: "invalid_uid", message: "" },
      members: [],
      linkedMemberIds: new Set(),
      pending,
      walkthroughStep: pending.step,
      translate,
      walkthroughSteps,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
    await audit(input.allianceId, input.discordUserId, "link_walkthrough", {}, result);
    return result;
  }

  if (!name || !uid) {
    const result: LinkCommandResult = {
      reply: translate("link.usage"),
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link", input, result);
    return result;
  }

  const lookup = await lookupPlayerByUid(uid);
  const [members, linkedMemberIds, alliance, guildRegistered] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getLinkedMemberIds(input.allianceId),
    getAllianceById(input.allianceId),
    input.guildId
      ? getGuildAllianceId(input.guildId).then((id) => id != null)
      : Promise.resolve(false),
  ]);

  const result = processLinkCommand({
    reportedName: name,
    gameUid: uid,
    lookup,
    members,
    linkedMemberIds,
    pending: pending as LinkPendingState | null,
    translate,
    walkthroughSteps,
    allianceTag: alliance?.tag ?? null,
  });

  let resolvedResult = result;
  let finalRosterMembers = members;
  if (result.needsOfficerAttention && lookup.ok) {
    const refreshed = await loadAllianceMembersForMemberLinkWithLiveRetry(
      input.allianceId,
      lookup.gameUserName,
    );
    if (refreshed.members !== members) {
      finalRosterMembers = refreshed.members;
      const retried = processLinkCommand({
        reportedName: name,
        gameUid: uid,
        lookup,
        members: refreshed.members,
        linkedMemberIds,
        pending: pending as LinkPendingState | null,
        translate,
        walkthroughSteps,
        allianceTag: alliance?.tag ?? null,
      });
      if (!retried.needsOfficerAttention) {
        resolvedResult = retried;
      }
    }
  }

  const linkDiagnostics = {
    memberCount: members.length,
    allianceTag: alliance?.tag ?? null,
    guildRegistered,
    gameUserName: lookup.ok ? lookup.gameUserName : null,
  };

  if ("linkTarget" in resolvedResult && resolvedResult.linkTarget) {
    const persisted = await persistLinkTarget({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      linkTarget: resolvedResult.linkTarget,
      replaceAll: input.replaceAll,
      translate,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    await audit(input.allianceId, input.discordUserId, "link", input, {
      ...persisted,
      diagnostics: linkDiagnostics,
    });
    return persisted;
  } else if (resolvedResult.pending) {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, resolvedResult.pending);
  } else {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  if (resolvedResult.needsOfficerAttention && lookup.ok) {
    const hqLink = await getDiscordHqLink(input.discordUserId);
    if (hqLink?.hqUserId) {
      const suggestion = findUniqueSubstringRosterCandidate(
        finalRosterMembers,
        lookup.gameUserName,
      );
      await createDiscordRosterMissLinkRequest({
        allianceId: input.allianceId,
        allianceTag: alliance?.tag ?? "alliance",
        discordUserId: input.discordUserId,
        discordUsername: input.discordUsername,
        hqUserId: hqLink.hqUserId,
        reportedName: name,
        gameUid: uid,
        gameUserName: lookup.gameUserName,
        gameServerNumber: lookup.gameServerNumber,
        gameUserLevel: lookup.gameUserLevel,
        suggestedTargetAshedMemberId: suggestion?.ashedMemberId ?? null,
        suggestionMethod: suggestion?.method ?? null,
      });
      resolvedResult = {
        ...resolvedResult,
        reply: translate("link.awaitingOfficerResolve"),
      };
    }
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [input.discordUsername ?? input.discordUserId],
    });
  }

  await audit(input.allianceId, input.discordUserId, "link", input, {
    ...resolvedResult,
    diagnostics: linkDiagnostics,
  });
  return resolvedResult;
}

/** @deprecated Use handleDiscordLinkCommanderSlash */
export const handleDiscordLinkSlash = handleDiscordLinkCommanderSlash;

export async function handleDiscordLinkFuzzyPick(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string;
  memberId: string;
  locale: DiscordBotLocale;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (!pending || pending.kind !== "link_fuzzy_pick") {
    const result: LinkCommandResult = {
      reply: translate("errors.nothingPending"),
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link_pick", input, result);
    return result;
  }

  const result = processLinkFuzzyPick({ pending, memberId: input.memberId, translate });
  if (result.linkTarget) {
    const persisted = await persistLinkTarget({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      linkTarget: result.linkTarget,
      translate,
    });
    if (persisted) {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      await audit(input.allianceId, input.discordUserId, "link_pick", input, persisted);
      return persisted;
    }
  }

  await audit(input.allianceId, input.discordUserId, "link_pick", input, result);
  return result;
}

async function resolveTargetLink(input: {
  allianceId: string;
  discordUserId: string;
  linkId?: string | null;
}) {
  if (input.linkId) {
    const link = await getDiscordLinkById(input.linkId);
    if (!link || link.allianceId !== input.allianceId) return null;
    if (link.discordUserId !== input.discordUserId) return null;
    return link;
  }
  const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
  if (links.length === 0) return null;
  if (links.length === 1) return links[0]!;
  return "pick";
}

export async function handleDiscordVrSlash(input: {
  allianceId: string;
  discordUserId: string;
  explicitLevel?: number | null;
  linkId?: string | null;
  locale: DiscordBotLocale;
}): Promise<VrCommandResult> {
  const { translate } = botContext(input.locale);
  const target = await resolveTargetLink(input);
  if (target === null) {
    const result: VrCommandResult = {
      reply: translate("vr.notLinked"),
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr", input, result);
    return result;
  }
  if (target === "pick") {
    const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
    const result: VrCommandResult = {
      reply: translate("vr.pickCharacter"),
      pending: { kind: "pick_character" as const, linkIds: links.map((l) => l.id) },
      action: { type: "none" as const },
      characterPicker: links.map((l) => ({
        linkId: l.id,
        label: l.memberDisplayName ?? l.ashedMemberId,
      })),
    };
    await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
    await audit(input.allianceId, input.discordUserId, "vr", input, result);
    return result;
  }

  const seasonKey = await resolveSeasonKey(input.allianceId);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = (pendingRow?.pending ?? null) as VrPendingState | null;
  const [seasonHigh, reporterCount, seasonRows] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, target.ashedMemberId, seasonKey),
    countSeasonReporters(input.allianceId, seasonKey),
    listSeasonVrRows(input.allianceId, seasonKey),
  ]);
  const peerMax = peerMaxExcludingMember(seasonRows, target.ashedMemberId);
  const maxBaseVr = await resolveMaxBaseVrForAlliance(input.allianceId);

  const result = processVrCommand({
    explicitLevel: input.explicitLevel,
    seasonHigh,
    ashedMemberId: target.ashedMemberId,
    pending,
    reporterCount,
    peerMax,
    translate,
    maxBaseVr,
  });

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);

  if (result.action.type === "set_vr") {
    await upsertMemberSeasonVr({
      allianceId: input.allianceId,
      ashedMemberId: result.action.ashedMemberId,
      seasonKey,
      baseVr: result.action.vr,
      discordUserId: input.discordUserId,
      flagReason: result.action.flagReason ?? null,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  await audit(input.allianceId, input.discordUserId, "vr", input, result);
  return result;
}

export async function handleDiscordVrCharacterPick(input: {
  allianceId: string;
  discordUserId: string;
  linkId: string;
  locale: DiscordBotLocale;
}) {
  return handleDiscordVrSlash({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    linkId: input.linkId,
    locale: input.locale,
  });
}

export async function handleDiscordVrButtonConfirm(input: {
  allianceId: string;
  discordUserId: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
}): Promise<VrCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending as VrPendingState | null;
  if (!pending || pending.kind !== "anomaly_confirm") {
    const result: VrCommandResult = {
      reply: translate("errors.noConfirm"),
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, result);
    return result;
  }

  const result = processVrConfirmation({ answer: input.answer, pending, translate });
  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);

  if (result.action.type === "set_vr") {
    const seasonKey = await resolveSeasonKey(input.allianceId);
    await upsertMemberSeasonVr({
      allianceId: input.allianceId,
      ashedMemberId: result.action.ashedMemberId,
      seasonKey,
      baseVr: result.action.vr,
      discordUserId: input.discordUserId,
      flagReason: result.action.flagReason ?? null,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  await audit(input.allianceId, input.discordUserId, "vr_confirm", input, result);
  return result;
}

export async function handleDiscordLinkStartOver(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}) {
  const { translate, walkthroughSteps } = botContext(input.locale);
  const pending: LinkPendingState = { kind: "link_walkthrough", step: 0 };
  const result: LinkCommandResult = {
    reply: walkthroughMessage(0, translate, walkthroughSteps),
    pending,
  };
  await saveDiscordBotPending(input.allianceId, input.discordUserId, pending);
  await audit(input.allianceId, input.discordUserId, "link_start_over", {}, result);
  return result;
}

export async function handleDiscordWalkthroughDone(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}) {
  const { translate, walkthroughSteps } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (!pending || pending.kind !== "link_walkthrough") {
    return { reply: translate("errors.noWalkthrough"), pending: null };
  }

  const result = advanceLinkWalkthrough({
    step: pending.step,
    translate,
    steps: walkthroughSteps,
  });

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
  await audit(input.allianceId, input.discordUserId, "link_walkthrough_done", {}, result);
  return result;
}
