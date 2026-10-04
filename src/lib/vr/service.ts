import { ActivityWriteError } from "@/lib/activity/errors.server";
import { emitAdminAlert } from "@/lib/events/admin-alerts";
import {
  createDiscordTranslator,
  tStringArray,
  type DiscordBotLocale,
  type DiscordTranslate,
} from "@/lib/discord/i18n";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { isVrAnomalyConfirmPending } from "@/lib/discord/bot-pending-guards.shared";
import { createDiscordAuthNonce } from "@/lib/vr/auth-nonce";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup.server";
import type { LastWarPlayerLookupResult } from "@/lib/lastwar/player-lookup";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import { peerMaxExcludingMember } from "@/lib/vr/anomaly";
import { MAX_DISCORD_LINKS_PER_USER } from "@/lib/vr/constants";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import {
  discordBotPendingMatchesCaller,
  gameUidFromDiscordLinkPending,
} from "@/lib/vr/discord-bot-pending-binding.shared";
import { effectiveBaseVr } from "@/lib/vr/effective-vr.shared";
import {
  processLinkCommand,
  processLinkFuzzyPick,
} from "@/lib/vr/link-command";
import {
  advanceLinkWalkthrough,
  findUniqueSubstringRosterCandidate,
} from "@/lib/vr/link-helpers";
import { ensureDiscordMemberLinksFromHq } from "@/lib/member-link/inherit-hq-to-discord.server";
import { tryPreApprovedMemberLink, honorLookupFromDiscordClaimInvite } from "@/lib/member-link/preapproved-link.server";
import { createDiscordRosterMissLinkRequest } from "@/lib/member-link/roster-link-request.server";
import { resolveMemberLinkServerEligibilityForUid } from "@/lib/member-link/server-eligibility.server";
import { trySelfServiceMemberLink } from "@/lib/member-link/self-service-onboarding.server";
import {
  loadAllianceMembersForBot,
  loadAllianceMembersForMemberLinkWithLiveRetry,
} from "@/lib/vr/member-roster";
import {
  vrSeasonLockedMessage,
  withVrSandboxDiscordNotice,
  type VrSeasonContext,
} from "@/lib/vr/vr-season-lock.shared";
import {
  formatInstituteLevelValidationError,
  instituteLevelForBaseVr,
  validateInstituteLevelForSeason,
} from "@/lib/vr/validation";
import {
  countSeasonReporters,
  getAllianceById,
  getDiscordBotPending,
  getDiscordHqLink,
  getDiscordLinkById,
  getGuildAllianceId,
  getCommanderByAshedMemberId,
  getLinkedMemberIds,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  listSeasonVrRows,
  linkDiscordMember,
  maybeClaimNativeOwnerFromDiscordLink,
  resolveVrSeasonContext,
  saveDiscordBotPending,
  setWeeklyPass,
  upsertMemberSeasonVr,
  VrPendingChangedError,
  VrSubmissionChangedError,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import { getCommanderMembershipInAlliance } from "@/lib/thp/repository";
import type {
  LinkCommandResult,
  LinkPendingState,
  VrCommandResult,
  VrPendingState,
  WeeklyPassCommandResult,
} from "@/lib/vr/types";

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
export {
  handleDiscordWhatIsMyVr,
  handleDiscordWhatIsMyThp,
  handleDiscordWhatIsMyKills,
} from "@/lib/vr/bot-status-query";
export { resolveDiscordAllianceId, resolveAllianceForGuild } from "@/lib/vr/repository";

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

function botContext(locale: DiscordBotLocale) {
  const translate = createDiscordTranslator(locale);
  const walkthroughSteps = tStringArray(locale, "link.steps");
  return { translate, walkthroughSteps };
}

async function runWithActivityErrors(
  translate: DiscordTranslate,
  work: () => Promise<VrCommandResult>,
): Promise<VrCommandResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof VrPendingChangedError) {
      return {
        reply: translate("errors.noConfirm"),
        pending: null,
        action: { type: "none" },
      };
    }
    if (
      error instanceof VrSubmissionChangedError ||
      error instanceof ActivityWriteError
    ) {
      return {
        reply: translate("activity.saveBlocked"),
        pending: null,
        action: { type: "none" },
      };
    }
    throw error;
  }
}

function applyVrSandboxReply(
  result: VrCommandResult,
  season: VrSeasonContext,
  translate: ReturnType<typeof createDiscordTranslator>,
): VrCommandResult {
  return {
    ...result,
    reply: withVrSandboxDiscordNotice(
      result.reply,
      season.vrSandboxActive,
      translate,
    ),
  };
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

function linkConfirmIdentityReply(
  translate: ReturnType<typeof createDiscordTranslator>,
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>,
  options?: { honorSystem?: boolean },
): string {
  if (options?.honorSystem) {
    return translate("link.confirmIdentityHonor", { name: lookup.gameUserName });
  }
  const body = translate("link.confirmIdentity", { name: lookup.gameUserName });
  if (lookup.gameServerNumber != null) {
    return `${body}\n\n${translate("link.confirmIdentityServer", {
      server: lookup.gameServerNumber,
    })}`;
  }
  return body;
}

/**
 * Pending confirm rows that already stored a live Last War server must keep that
 * verified identity when a later lookup attempt fails — never synthesize honor.
 */
function verifiedLookupFromPending(
  pending:
    | Extract<LinkPendingState, { kind: "link_confirm_identity" }>
    | Extract<LinkPendingState, { kind: "link_confirm_home_server" }>,
): Extract<LastWarPlayerLookupResult, { ok: true }> | null {
  if (pending.kind === "link_confirm_home_server") {
    return {
      ok: true,
      gameUserName: pending.gameUserName,
      gameServerNumber: pending.lookupServer,
      ...(pending.gameUserLevel != null
        ? { gameUserLevel: pending.gameUserLevel }
        : {}),
    };
  }
  if (typeof pending.gameServerNumber === "number") {
    return {
      ok: true,
      gameUserName: pending.gameUserName,
      gameServerNumber: pending.gameServerNumber,
      ...(pending.gameUserLevel != null
        ? { gameUserLevel: pending.gameUserLevel }
        : {}),
    };
  }
  return null;
}

async function finalizeDiscordHonorClaimLink(input: {
  allianceId: string;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  replaceAll?: boolean;
  locale: DiscordBotLocale;
  auditAction?: string;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const uid = input.gameUid.trim();
  const hqLink = await getDiscordHqLink(input.discordUserId);
  if (!hqLink?.hqUserId) {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    const result: LinkCommandResult = {
      reply: translate("link.lookupUnavailableAskClaimInvite"),
      pending: null,
    };
    await audit(
      input.allianceId,
      input.discordUserId,
      input.auditAction ?? "link",
      input,
      result,
    );
    return result;
  }

  const preapproved = await tryPreApprovedMemberLink({
    allianceId: input.allianceId,
    hqUserId: hqLink.hqUserId,
    gameUid: uid,
    lookup: input.lookup,
    requesterHandle: input.discordUsername ?? input.discordUserId,
    honorSystem: true,
  });

  if (preapproved.ok) {
    const persisted = await persistLinkTarget({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      linkTarget: {
        ashedMemberId: preapproved.target.ashedMemberId,
        memberDisplayName: preapproved.target.memberDisplayName,
        gameUid: preapproved.target.gameUid,
      },
      replaceAll: input.replaceAll,
      translate,
    });
    const result: LinkCommandResult = persisted.linked
      ? {
          ...persisted,
          reply: translate("link.claimLookupHonorLinked", {
            name: preapproved.target.memberDisplayName,
          }),
        }
      : persisted;
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    await audit(
      input.allianceId,
      input.discordUserId,
      input.auditAction ?? "link",
      input,
      result,
    );
    return result;
  }

  await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  const result: LinkCommandResult =
    preapproved.reason === "commander_taken"
      ? { reply: translate("link.memberTaken"), pending: null, memberTaken: true }
      : preapproved.reason === "claim_conflict"
        ? { reply: translate("link.awaitingOfficerResolve"), pending: null }
        : {
            reply: translate("link.lookupUnavailableAskClaimInvite"),
            pending: null,
          };
  await audit(
    input.allianceId,
    input.discordUserId,
    input.auditAction ?? "link",
    input,
    result,
  );
  return result;
}

async function finalizeDiscordMemberLink(input: {
  allianceId: string;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  gameUid: string;
  lookup: Extract<LastWarPlayerLookupResult, { ok: true }>;
  replaceAll?: boolean;
  locale: DiscordBotLocale;
  identityConfirmed: boolean;
  auditAction?: string;
  allianceHomeConfirmed?: boolean;
  userClaimedLookupAsHome?: boolean;
  honorSystem?: boolean;
}): Promise<LinkCommandResult> {
  // Claim-invite honor path must not go through exact roster match + server
  // eligibility (honor lookups have no gameServerNumber).
  if (input.honorSystem) {
    return finalizeDiscordHonorClaimLink(input);
  }

  const { translate, walkthroughSteps } = botContext(input.locale);
  const gameUserName = input.lookup.gameUserName;
  const uid = input.gameUid.trim();

  const [members, linkedMemberIds, alliance, guildRegistered] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getLinkedMemberIds(input.allianceId),
    getAllianceById(input.allianceId),
    input.guildId
      ? getGuildAllianceId(input.guildId).then((id) => id != null)
      : Promise.resolve(false),
  ]);

  const result = processLinkCommand({
    reportedName: gameUserName,
    gameUid: uid,
    lookup: input.lookup,
    members,
    linkedMemberIds,
    pending: null,
    translate,
    walkthroughSteps,
    allianceTag: alliance?.tag ?? null,
    identityConfirmed: input.identityConfirmed,
  });

  let resolvedResult = result;
  let finalRosterMembers = members;
  if (result.needsOfficerAttention) {
    const refreshed = await loadAllianceMembersForMemberLinkWithLiveRetry(
      input.allianceId,
      gameUserName,
    );
    if (refreshed.members !== members) {
      finalRosterMembers = refreshed.members;
      const retried = processLinkCommand({
        reportedName: gameUserName,
        gameUid: uid,
        lookup: input.lookup,
        members: refreshed.members,
        linkedMemberIds,
        pending: null,
        translate,
        walkthroughSteps,
        allianceTag: alliance?.tag ?? null,
        identityConfirmed: input.identityConfirmed,
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
    gameUserName,
  };

  // Exact roster match from processLinkCommand — must gate before persist so a
  // same-name commander on another server cannot skip confirm_home / wrong_server
  // (and cannot sole-R5 native-owner claim via maybeClaimNativeOwnerFromDiscordLink).
  const exactMatchLinkTarget = Boolean(
    "linkTarget" in resolvedResult && resolvedResult.linkTarget,
  );

  // Already linked on HQ web, or accepted a commander claim invite: do not send
  // officers through roster-link approval again.
  if (!exactMatchLinkTarget) {
    const hqLink = await getDiscordHqLink(input.discordUserId);
    if (hqLink?.hqUserId) {
      const preapproved = await tryPreApprovedMemberLink({
        allianceId: input.allianceId,
        hqUserId: hqLink.hqUserId,
        gameUid: uid,
        lookup: input.lookup,
        requesterHandle: input.discordUsername ?? input.discordUserId,
        honorSystem: input.honorSystem,
      });
      if (preapproved.ok) {
        resolvedResult = {
          reply: translate("link.linked", {
            name: preapproved.target.memberDisplayName,
          }),
          pending: null,
          linked: true,
          linkTarget: {
            ashedMemberId: preapproved.target.ashedMemberId,
            memberDisplayName: preapproved.target.memberDisplayName,
            gameUid: preapproved.target.gameUid,
            ...(input.lookup.gameUserLevel != null
              ? { gameUserLevel: input.lookup.gameUserLevel }
              : {}),
          },
        };
      } else if (preapproved.reason === "commander_taken") {
        resolvedResult = {
          reply: translate("link.memberTaken"),
          pending: null,
          memberTaken: true,
        };
      } else if (preapproved.reason === "claim_conflict") {
        resolvedResult = {
          reply: translate("link.awaitingOfficerResolve"),
          pending: null,
        };
      }
    }
  }

  if ("linkTarget" in resolvedResult && resolvedResult.linkTarget) {
    if (exactMatchLinkTarget) {
      const serverEligibility = await resolveMemberLinkServerEligibilityForUid({
        allianceId: input.allianceId,
        gameUid: uid,
        lookupServer: input.lookup.gameServerNumber,
        allianceHomeConfirmed: input.allianceHomeConfirmed,
        userClaimedLookupAsHome: input.userClaimedLookupAsHome,
      });
      if (serverEligibility.kind === "confirm_home") {
        const confirmPending: LinkPendingState = {
          kind: "link_confirm_home_server",
          gameUid: uid,
          gameUserName: input.lookup.gameUserName,
          lookupServer: serverEligibility.lookupServer,
          allianceServer: serverEligibility.allianceServer,
          ...(input.lookup.gameUserLevel != null
            ? { gameUserLevel: input.lookup.gameUserLevel }
            : {}),
          ...(input.replaceAll ? { replaceAll: true } : {}),
        };
        await saveDiscordBotPending(
          input.allianceId,
          input.discordUserId,
          confirmPending,
        );
        const result: LinkCommandResult = {
          reply: translate("confirmHomeServerPrompt", {
            commanderName: input.lookup.gameUserName,
            lookupServer: serverEligibility.lookupServer,
            allianceTag: alliance?.tag ?? "alliance",
            allianceServer: serverEligibility.allianceServer,
          }),
          pending: confirmPending,
          needsHomeServerConfirmation: true,
        };
        await audit(
          input.allianceId,
          input.discordUserId,
          input.auditAction ?? "link",
          input,
          { ...result, diagnostics: linkDiagnostics },
        );
        return result;
      }
      if (serverEligibility.kind === "rejected") {
        await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
        const rejected: LinkCommandResult =
          serverEligibility.reason === "user_claimed_lookup_home"
            ? {
                reply: translate("positionNotHomeBody"),
                pending: null,
                positionNotHome: true,
              }
            : {
                reply: translate("helpTopics.wrongServer.body"),
                pending: null,
                wrongServer: true,
              };
        await audit(
          input.allianceId,
          input.discordUserId,
          input.auditAction ?? "link",
          input,
          { ...rejected, diagnostics: linkDiagnostics },
        );
        return rejected;
      }
    }

    const persisted = await persistLinkTarget({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      linkTarget: resolvedResult.linkTarget,
      replaceAll: input.replaceAll,
      translate,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    await audit(
      input.allianceId,
      input.discordUserId,
      input.auditAction ?? "link",
      input,
      {
        ...persisted,
        diagnostics: linkDiagnostics,
      },
    );
    return persisted;
  }

  if (resolvedResult.pending) {
    await saveDiscordBotPending(
      input.allianceId,
      input.discordUserId,
      resolvedResult.pending,
    );
  } else if (resolvedResult.needsOfficerAttention) {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, {
      kind: "link_roster_miss",
      gameUid: uid,
      gameUserName,
      reportedName: gameUserName,
    });
  } else {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  let rosterLinkRequestCreated: boolean | null = null;
  if (resolvedResult.needsOfficerAttention) {
    const hqLink = await getDiscordHqLink(input.discordUserId);
    const selfService = await trySelfServiceMemberLink({
      allianceId: input.allianceId,
      hqUserId: hqLink?.hqUserId ?? null,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      gameUid: uid,
      lookup: input.lookup,
      members: finalRosterMembers,
      linkedMemberIds,
      origin: "discord",
      gameServerNumber: input.lookup.gameServerNumber,
      allianceHomeConfirmed: input.allianceHomeConfirmed,
      userClaimedLookupAsHome: input.userClaimedLookupAsHome,
      persistLink: async (target) => {
        const linked = await linkDiscordMember({
          allianceId: input.allianceId,
          discordUserId: input.discordUserId,
          discordUsername: input.discordUsername,
          ashedMemberId: target.ashedMemberId,
          memberDisplayName: target.memberDisplayName,
          gameUid: target.gameUid,
          replaceAll: input.replaceAll,
        });
        if (!linked.ok) {
          return { ok: false as const, reason: "member_taken" as const };
        }
        if (target.gameUserLevel != null) {
          try {
            await syncAllianceMemberGameLevelFromLastWar({
              allianceId: input.allianceId,
              ashedMemberId: target.ashedMemberId,
              gameUserLevel: target.gameUserLevel,
            });
          } catch (error) {
            console.error("[discord-bot] member level sync failed", error);
          }
        }
        try {
          await maybeClaimNativeOwnerFromDiscordLink({
            allianceId: input.allianceId,
            ashedMemberId: target.ashedMemberId,
          });
        } catch (error) {
          console.error("[discord-bot] native owner claim failed", error);
        }
        if (hqLink?.hqUserId) {
          try {
            await syncCommanderIdentityFromMemberLink({
              allianceId: input.allianceId,
              ashedMemberId: target.ashedMemberId,
              hqUserId: hqLink.hqUserId,
              gameUid: target.gameUid,
              memberDisplayName: target.memberDisplayName,
            });
          } catch (error) {
            console.error("[discord-bot] commander identity sync failed", error);
          }
        }
        return { ok: true as const };
      },
    });

    if (selfService.ok) {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      const replyKey = selfService.reviewCreated
        ? hqLink?.hqUserId
          ? "link.linkedWithReview"
          : "link.linkedWithReviewNoHq"
        : "link.linked";
      const result: LinkCommandResult = {
        reply: translate(replyKey, { name: selfService.memberDisplayName }),
        pending: null,
        linked: true,
        linkTarget: {
          ashedMemberId: selfService.ashedMemberId,
          memberDisplayName: selfService.memberDisplayName,
          gameUid: uid,
          ...(input.lookup.gameUserLevel != null
            ? { gameUserLevel: input.lookup.gameUserLevel }
            : {}),
        },
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...result,
          selfService: true,
          reviewCreated: selfService.reviewCreated,
          diagnostics: linkDiagnostics,
        },
      );
      return result;
    }

    if (selfService.reason === "confirm_home") {
      const confirmPending: LinkPendingState = {
        kind: "link_confirm_home_server",
        gameUid: uid,
        gameUserName: input.lookup.gameUserName,
        lookupServer: selfService.lookupServer ?? 0,
        allianceServer: selfService.allianceServer ?? 0,
        ...(input.lookup.gameUserLevel != null
          ? { gameUserLevel: input.lookup.gameUserLevel }
          : {}),
        ...(input.replaceAll ? { replaceAll: true } : {}),
      };
      await saveDiscordBotPending(
        input.allianceId,
        input.discordUserId,
        confirmPending,
      );
      const result: LinkCommandResult = {
        reply: translate("link.confirmHomeServerPrompt", {
          commanderName: selfService.commanderName ?? input.lookup.gameUserName,
          lookupServer: selfService.lookupServer ?? 0,
          allianceTag: alliance?.tag ?? "alliance",
          allianceServer: selfService.allianceServer ?? 0,
        }),
        pending: confirmPending,
        needsHomeServerConfirmation: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...result,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return result;
    }

    if (selfService.reason === "position_not_home") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      resolvedResult = {
        ...resolvedResult,
        reply: translate("link.positionNotHomeBody"),
        pending: null,
        needsOfficerAttention: false,
        positionNotHome: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...resolvedResult,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return resolvedResult;
    }

    if (selfService.reason === "wrong_server") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      resolvedResult = {
        ...resolvedResult,
        reply: translate("helpTopics.wrongServer.body"),
        pending: null,
        needsOfficerAttention: false,
        wrongServer: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...resolvedResult,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return resolvedResult;
    }

    if (selfService.reason === "member_taken") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      resolvedResult = {
        ...resolvedResult,
        reply: translate("link.memberTaken"),
        pending: null,
        memberTaken: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...resolvedResult,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return resolvedResult;
    }

    const suggestion = findUniqueSubstringRosterCandidate(
      finalRosterMembers,
      gameUserName,
    );
    const rosterMiss = await createDiscordRosterMissLinkRequest({
      allianceId: input.allianceId,
      allianceTag: alliance?.tag ?? "alliance",
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      hqUserId: hqLink?.hqUserId ?? null,
      reportedName: gameUserName,
      gameUid: uid,
      gameUserName,
      gameServerNumber: input.lookup.gameServerNumber,
      gameUserLevel: input.lookup.gameUserLevel,
      suggestedTargetAshedMemberId: suggestion?.ashedMemberId ?? null,
      suggestionMethod: suggestion?.method ?? null,
      suggestedMatchedRosterName: suggestion?.matchedRosterName ?? null,
      allianceHomeConfirmed: input.allianceHomeConfirmed,
      userClaimedLookupAsHome: input.userClaimedLookupAsHome,
    });

    if (rosterMiss.status === "confirm_home") {
      const confirmPending: LinkPendingState = {
        kind: "link_confirm_home_server",
        gameUid: uid,
        gameUserName: input.lookup.gameUserName,
        lookupServer: rosterMiss.lookupServer,
        allianceServer: rosterMiss.allianceServer,
        ...(input.lookup.gameUserLevel != null
          ? { gameUserLevel: input.lookup.gameUserLevel }
          : {}),
        ...(input.replaceAll ? { replaceAll: true } : {}),
      };
      await saveDiscordBotPending(
        input.allianceId,
        input.discordUserId,
        confirmPending,
      );
      const result: LinkCommandResult = {
        reply: translate("confirmHomeServerPrompt", {
          commanderName: input.lookup.gameUserName,
          lookupServer: rosterMiss.lookupServer,
          allianceTag: alliance?.tag ?? "alliance",
          allianceServer: rosterMiss.allianceServer,
        }),
        pending: confirmPending,
        needsHomeServerConfirmation: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...result,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return result;
    }

    if (rosterMiss.status === "position_not_home") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      resolvedResult = {
        ...resolvedResult,
        reply: translate("positionNotHomeBody"),
        pending: null,
        needsOfficerAttention: false,
        positionNotHome: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...resolvedResult,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return resolvedResult;
    }

    if (rosterMiss.status === "wrong_server") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      resolvedResult = {
        ...resolvedResult,
        reply: translate("helpTopics.wrongServer.body"),
        pending: null,
        needsOfficerAttention: false,
        wrongServer: true,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        input.auditAction ?? "link",
        input,
        {
          ...resolvedResult,
          selfService: false,
          diagnostics: linkDiagnostics,
        },
      );
      return resolvedResult;
    }

    if (rosterMiss.status === "created") {
      rosterLinkRequestCreated = true;
      const rosterFull = selfService.reason === "roster_full";
      resolvedResult = {
        ...resolvedResult,
        reply: translate(
          rosterFull
            ? "link.rosterFull"
            : hqLink?.hqUserId
              ? "link.awaitingOfficerResolve"
              : "link.awaitingOfficerResolveNoHq",
          rosterFull ? { gameName: gameUserName } : undefined,
        ),
      };
    } else {
      rosterLinkRequestCreated = false;
      console.error("[discord-bot] roster miss queue creation failed", {
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
        hqLinked: Boolean(hqLink?.hqUserId),
      });
    }
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [input.discordUsername ?? input.discordUserId],
    });
  }

  await audit(input.allianceId, input.discordUserId, input.auditAction ?? "link", input, {
    ...resolvedResult,
    ...(rosterLinkRequestCreated === null ? {} : { rosterLinkRequestCreated }),
    diagnostics: linkDiagnostics,
  });
  return resolvedResult;
}

async function issueDiscordMemberLinkPrompt(input: {
  allianceId: string | null;
  guildId?: string | null;
  discordUserId: string;
  replaceAll?: boolean;
  locale: DiscordBotLocale;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const nonce = await createDiscordAuthNonce({
    discordUserId: input.discordUserId,
    guildId: input.guildId ?? null,
    purpose: "member_link",
    memberLinkReplaceAll: input.replaceAll,
  });
  const url = buildDiscordBotAppUrl(
    input.locale,
    `/discord/link-commander?nonce=${nonce}`,
  );
  const result: LinkCommandResult = {
    reply: translate("link.commanderPrompt", { url }),
    pending: null,
  };
  await audit(input.allianceId, input.discordUserId, "link", input, result);
  return result;
}

export async function handleDiscordLinkCommanderSlash(input: {
  allianceId: string | null;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  gameUid?: string;
  replaceAll?: boolean;
  locale: DiscordBotLocale;
}): Promise<LinkCommandResult> {
  const { translate, walkthroughSteps } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending ?? null;

  const uid = input.gameUid?.trim();

  if (pending?.kind === "link_walkthrough" && !uid) {
    if (!input.allianceId) {
      return issueDiscordMemberLinkPrompt(input);
    }
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

  if (!uid) {
    return issueDiscordMemberLinkPrompt(input);
  }

  if (!input.allianceId) {
    const result: LinkCommandResult = {
      reply: translate("errors.waitForGuildRegistration"),
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link", input, result);
    return result;
  }

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok) {
    if (lookup.reason === "request_failed") {
      const honor = await honorLookupFromDiscordClaimInvite({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
      });
      if (honor) {
        const confirmPending: LinkPendingState = {
          kind: "link_confirm_identity",
          gameUid: uid,
          gameUserName: honor.gameUserName,
          ...(input.replaceAll ? { replaceAll: true } : {}),
        };
        const result: LinkCommandResult = {
          reply: linkConfirmIdentityReply(translate, honor, { honorSystem: true }),
          pending: confirmPending,
          needsIdentityConfirmation: true,
        };
        await saveDiscordBotPending(
          input.allianceId,
          input.discordUserId,
          confirmPending,
        );
        await audit(
          input.allianceId,
          input.discordUserId,
          "link_preview",
          input,
          result,
        );
        return result;
      }
      const result: LinkCommandResult = {
        reply: translate("link.lookupUnavailableAskClaimInvite"),
        pending: null,
      };
      await audit(input.allianceId, input.discordUserId, "link", input, result);
      return result;
    }
    const result: LinkCommandResult = {
      reply: lookup.message,
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link", input, result);
    return result;
  }

  const confirmPending: LinkPendingState = {
    kind: "link_confirm_identity",
    gameUid: uid,
    gameUserName: lookup.gameUserName,
    ...(lookup.gameUserLevel != null ? { gameUserLevel: lookup.gameUserLevel } : {}),
    ...(typeof lookup.gameServerNumber === "number"
      ? { gameServerNumber: lookup.gameServerNumber }
      : {}),
    ...(input.replaceAll ? { replaceAll: true } : {}),
  };

  const result: LinkCommandResult = {
    reply: linkConfirmIdentityReply(translate, lookup),
    pending: confirmPending,
    needsIdentityConfirmation: true,
  };
  await saveDiscordBotPending(input.allianceId, input.discordUserId, confirmPending);
  await audit(input.allianceId, input.discordUserId, "link_preview", input, result);
  return result;
}

export async function handleDiscordLinkIdentityConfirm(input: {
  allianceId: string;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
  /** When set (web confirm UI), must match the pending UID shown to the user. */
  expectedGameUid?: string | null;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;

  if (
    !pendingRow ||
    !pending ||
    pending.kind !== "link_confirm_identity" ||
    !discordBotPendingMatchesCaller({
      pendingAllianceId: pendingRow.allianceId,
      callerAllianceId: input.allianceId,
      pendingGameUid: gameUidFromDiscordLinkPending(pending),
      expectedGameUid: input.expectedGameUid,
    })
  ) {
    const result: LinkCommandResult = {
      reply: translate("link.confirmExpired"),
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link_confirm", input, result);
    return result;
  }

  if (input.answer === "no") {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    const result: LinkCommandResult = {
      reply: translate("link.confirmIdentityDeclined"),
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link_confirm", input, result);
    return result;
  }

  const lookup = await lookupPlayerByUid(pending.gameUid);
  if (!lookup.ok) {
    if (lookup.reason === "request_failed") {
      // Keep a previously verified pending identity; only honor via claim invite
      // when this attempt never got a live lookup (no stored server).
      const verified = verifiedLookupFromPending(pending);
      if (verified) {
        return finalizeDiscordMemberLink({
          allianceId: input.allianceId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          discordUsername: input.discordUsername,
          gameUid: pending.gameUid,
          lookup: verified,
          replaceAll: pending.replaceAll,
          locale: input.locale,
          identityConfirmed: true,
          auditAction: "link_confirm",
        });
      }
      const honor = await honorLookupFromDiscordClaimInvite({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
      });
      if (honor) {
        return finalizeDiscordMemberLink({
          allianceId: input.allianceId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          discordUsername: input.discordUsername,
          gameUid: pending.gameUid,
          lookup: honor,
          replaceAll: pending.replaceAll,
          locale: input.locale,
          identityConfirmed: true,
          auditAction: "link_confirm",
          honorSystem: true,
        });
      }
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      const result: LinkCommandResult = {
        reply: translate("link.lookupUnavailableAskClaimInvite"),
        pending: null,
      };
      await audit(input.allianceId, input.discordUserId, "link_confirm", input, result);
      return result;
    }
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    const result: LinkCommandResult = {
      reply: lookup.message,
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link_confirm", input, result);
    return result;
  }

  return finalizeDiscordMemberLink({
    allianceId: input.allianceId,
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    gameUid: pending.gameUid,
    lookup,
    replaceAll: pending.replaceAll,
    locale: input.locale,
    identityConfirmed: true,
    auditAction: "link_confirm",
  });
}

export async function handleDiscordLinkHomeServerConfirm(input: {
  allianceId: string;
  guildId?: string | null;
  discordUserId: string;
  discordUsername?: string;
  choice: "alliance" | "lookup";
  locale: DiscordBotLocale;
  /** When set (web confirm UI), must match the pending UID shown to the user. */
  expectedGameUid?: string | null;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;

  if (
    !pendingRow ||
    !pending ||
    pending.kind !== "link_confirm_home_server" ||
    !discordBotPendingMatchesCaller({
      pendingAllianceId: pendingRow.allianceId,
      callerAllianceId: input.allianceId,
      pendingGameUid: gameUidFromDiscordLinkPending(pending),
      expectedGameUid: input.expectedGameUid,
    })
  ) {
    const result: LinkCommandResult = {
      reply: translate("link.confirmExpired"),
      pending: null,
    };
    await audit(
      input.allianceId,
      input.discordUserId,
      "link_confirm_home",
      input,
      result,
    );
    return result;
  }

  const lookup = await lookupPlayerByUid(pending.gameUid);
  if (!lookup.ok) {
    if (lookup.reason === "request_failed") {
      // Home-server pending always carries lookupServer from a prior live lookup.
      const verified = verifiedLookupFromPending(pending);
      if (verified) {
        return finalizeDiscordMemberLink({
          allianceId: input.allianceId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          discordUsername: input.discordUsername,
          gameUid: pending.gameUid,
          lookup: verified,
          replaceAll: pending.replaceAll,
          locale: input.locale,
          identityConfirmed: true,
          auditAction: "link_confirm_home",
          allianceHomeConfirmed: input.choice === "alliance",
          userClaimedLookupAsHome: input.choice === "lookup",
        });
      }
      const honor = await honorLookupFromDiscordClaimInvite({
        allianceId: input.allianceId,
        discordUserId: input.discordUserId,
      });
      if (honor) {
        return finalizeDiscordMemberLink({
          allianceId: input.allianceId,
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          discordUsername: input.discordUsername,
          gameUid: pending.gameUid,
          lookup: honor,
          replaceAll: pending.replaceAll,
          locale: input.locale,
          identityConfirmed: true,
          auditAction: "link_confirm_home",
          allianceHomeConfirmed: input.choice === "alliance",
          userClaimedLookupAsHome: input.choice === "lookup",
          honorSystem: true,
        });
      }
      await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
      const result: LinkCommandResult = {
        reply: translate("link.lookupUnavailableAskClaimInvite"),
        pending: null,
      };
      await audit(
        input.allianceId,
        input.discordUserId,
        "link_confirm_home",
        input,
        result,
      );
      return result;
    }
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    const result: LinkCommandResult = {
      reply: lookup.message,
      pending: null,
    };
    await audit(
      input.allianceId,
      input.discordUserId,
      "link_confirm_home",
      input,
      result,
    );
    return result;
  }

  return finalizeDiscordMemberLink({
    allianceId: input.allianceId,
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    gameUid: pending.gameUid,
    lookup,
    replaceAll: pending.replaceAll,
    locale: input.locale,
    identityConfirmed: true,
    auditAction: "link_confirm_home",
    allianceHomeConfirmed: input.choice === "alliance",
    userClaimedLookupAsHome: input.choice === "lookup",
  });
}

/** @deprecated Use handleDiscordLinkCommanderSlash */
export const handleDiscordLinkSlash = handleDiscordLinkCommanderSlash;

export async function handleDiscordLinkFuzzyPick(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string;
  memberId: string;
  locale: DiscordBotLocale;
  /** When set (web confirm UI), must match the pending UID shown to the user. */
  expectedGameUid?: string | null;
}): Promise<LinkCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (
    !pendingRow ||
    !pending ||
    pending.kind !== "link_fuzzy_pick" ||
    !discordBotPendingMatchesCaller({
      pendingAllianceId: pendingRow.allianceId,
      callerAllianceId: input.allianceId,
      pendingGameUid: gameUidFromDiscordLinkPending(pending),
      expectedGameUid: input.expectedGameUid,
    })
  ) {
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
  let links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
    rematerializeFormer: true,
  });
  if (links.length === 0) {
    // Users who linked a commander on the web, then `/link`ed Discord, should
    // not need a second name+UID pass on Discord.
    await ensureDiscordMemberLinksFromHq({
      discordUserId: input.discordUserId,
      allianceId: input.allianceId,
    });
    links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
      rematerializeFormer: true,
    });
  }
  if (links.length === 0) return null;
  if (links.length === 1) return links[0]!;
  return "pick";
}

export async function handleDiscordVrSlash(input: {
  allianceId: string;
  discordUserId: string;
  explicitInstituteLevel?: number | null;
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
    const season = await resolveVrSeasonContext(input.allianceId);
    if (season.vrUpdatesLocked) {
      const result: VrCommandResult = {
        reply: vrSeasonLockedMessage(translate),
        pending: null,
        action: { type: "none" as const },
      };
      await audit(input.allianceId, input.discordUserId, "vr", input, result);
      return result;
    }
    const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId, {
      rematerializeFormer: true,
    });
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
    return applyVrSandboxReply(result, season, translate);
  }

  const season = await resolveVrSeasonContext(input.allianceId);
  if (season.vrUpdatesLocked) {
    const result: VrCommandResult = {
      reply: vrSeasonLockedMessage(translate),
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr", input, result);
    return result;
  }

  const seasonKey = season.seasonKey;
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending =
    pendingRow && pendingRow.allianceId === input.allianceId
      ? ((pendingRow.pending ?? null) as VrPendingState | null)
      : null;
  const [seasonHigh, reporterCount, seasonRows, commander] = await Promise.all([
    getMemberSeasonHigh(input.allianceId, target.ashedMemberId, seasonKey),
    countSeasonReporters(input.allianceId, seasonKey),
    listSeasonVrRows(input.allianceId, seasonKey),
    getCommanderByAshedMemberId(target.ashedMemberId, input.allianceId),
  ]);
  const peerMax = peerMaxExcludingMember(seasonRows, target.ashedMemberId);

  let explicitBaseVr: number | undefined;
  if (input.explicitInstituteLevel != null) {
    const validated = validateInstituteLevelForSeason(
      seasonKey,
      input.explicitInstituteLevel,
    );
    if (!validated.ok) {
      const result: VrCommandResult = {
        reply: formatInstituteLevelValidationError(validated),
        pending,
        action: { type: "none" as const },
      };
      await audit(input.allianceId, input.discordUserId, "vr", input, result);
      return applyVrSandboxReply(result, season, translate);
    }
    explicitBaseVr = validated.baseVr;
  }

  const result = await runWithActivityErrors(translate, async () => {
    const processed = processVrCommand({
      explicitLevel: explicitBaseVr,
      seasonHigh,
      ashedMemberId: target.ashedMemberId,
      commanderId: commander?.commanderId ?? null,
      pending,
      reporterCount,
      peerMax,
      translate,
      seasonKey,
    });

    if (processed.action.type === "set_vr") {
      await upsertMemberSeasonVr({
        allianceId: input.allianceId,
        ashedMemberId: processed.action.ashedMemberId || target.ashedMemberId,
        commanderId: processed.action.commanderId ?? commander?.commanderId,
        seasonKey,
        baseVr: processed.action.vr,
        discordUserId: input.discordUserId,
        flagReason: processed.action.flagReason ?? null,
        eventSource: "discord",
        activity: {
          identity: { kind: "discord", discordUserId: input.discordUserId },
          expectedPreviousBaseVr: seasonHigh,
          ...(pending
            ? { pending: { expected: pending, required: false } }
            : {}),
        },
      });
      const instituteLevel =
        instituteLevelForBaseVr(seasonKey, processed.action.vr) ?? "?";
      const effectiveVr = effectiveBaseVr(
        processed.action.vr,
        commander?.weeklyPassActive ?? false,
      );
      processed.reply = translate("vr.success", {
        level: instituteLevel,
        effectiveVr,
      });
      return processed;
    }

    await saveDiscordBotPending(
      input.allianceId,
      input.discordUserId,
      processed.pending,
    );
    return processed;
  });

  await audit(input.allianceId, input.discordUserId, "vr", input, result);
  return applyVrSandboxReply(result, season, translate);
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

export async function handleDiscordWeeklyPass(input: {
  discordUserId: string;
  allianceId: string;
  guildId: string;
  locale: DiscordBotLocale;
  active: boolean;
  linkId?: string | null;
}): Promise<WeeklyPassCommandResult> {
  const { translate } = botContext(input.locale);
  const target = await resolveTargetLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    linkId: input.linkId,
  });

  if (target === null) {
    const reply = translate("vr.notLinked");
    await audit(input.allianceId, input.discordUserId, "weekly-pass", input, {
      reply,
    });
    return { reply };
  }

  if (target === "pick") {
    const links = await listDiscordLinksForUser(
      input.allianceId,
      input.discordUserId,
      { rematerializeFormer: true },
    );
    const pending: VrPendingState = {
      kind: "weekly_pass_pick_character",
      linkIds: links.map((l) => l.id),
      active: input.active,
    };
    await saveDiscordBotPending(input.allianceId, input.discordUserId, pending);
    const reply = translate("weeklyPass.pickCharacter");
    const characterPicker = links.map((l) => ({
      linkId: l.id,
      label: l.memberDisplayName ?? l.ashedMemberId,
    }));
    await audit(input.allianceId, input.discordUserId, "weekly-pass", input, {
      reply,
      pending,
    });
    return { reply, characterPicker };
  }

  const result = await applyWeeklyPassForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    ashedMemberId: target.ashedMemberId,
    active: input.active,
    translate,
  });
  await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  await audit(input.allianceId, input.discordUserId, "weekly-pass", input, result);
  return result;
}

export async function handleDiscordWeeklyPassCharacterPick(input: {
  allianceId: string;
  discordUserId: string;
  linkId: string;
  locale: DiscordBotLocale;
}): Promise<WeeklyPassCommandResult> {
  const { translate } = botContext(input.locale);
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = (pendingRow?.pending ?? null) as VrPendingState | null;

  if (!pending || pending.kind !== "weekly_pass_pick_character") {
    const reply = translate("weeklyPass.pickExpired");
    await audit(
      input.allianceId,
      input.discordUserId,
      "weekly-pass_pick",
      input,
      { reply },
    );
    return { reply };
  }

  const link = await getDiscordLinkById(input.linkId);
  if (
    !link ||
    link.allianceId !== input.allianceId ||
    link.discordUserId !== input.discordUserId ||
    !pending.linkIds.includes(link.id)
  ) {
    const reply = translate("weeklyPass.pickExpired");
    await audit(
      input.allianceId,
      input.discordUserId,
      "weekly-pass_pick",
      input,
      { reply },
    );
    return { reply };
  }

  const result = await applyWeeklyPassForLink({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    ashedMemberId: link.ashedMemberId,
    active: pending.active,
    translate,
  });
  await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  await audit(
    input.allianceId,
    input.discordUserId,
    "weekly-pass_pick",
    input,
    result,
  );
  return result;
}

async function applyWeeklyPassForLink(input: {
  allianceId: string;
  discordUserId: string;
  ashedMemberId: string;
  active: boolean;
  translate: DiscordTranslate;
}): Promise<WeeklyPassCommandResult> {
  const commander = await getCommanderByAshedMemberId(
    input.ashedMemberId,
    input.allianceId,
  );
  if (!commander) {
    return { reply: input.translate("weeklyPass.commanderNotFound") };
  }

  try {
    await setWeeklyPass({
      commanderId: commander.commanderId,
      active: input.active,
      source: "self",
    });
  } catch (error) {
    console.error("[discord-bot] weekly-pass update failed", error);
    return { reply: input.translate("weeklyPass.updateFailed") };
  }

  const reply = input.active
    ? input.translate("weeklyPass.activated")
    : input.translate("weeklyPass.deactivated");
  return { reply };
}

export async function handleDiscordVrButtonConfirm(input: {
  allianceId: string;
  discordUserId: string;
  answer: "yes" | "no";
  locale: DiscordBotLocale;
}): Promise<VrCommandResult> {
  const { translate } = botContext(input.locale);
  const season = await resolveVrSeasonContext(input.allianceId);
  if (season.vrUpdatesLocked) {
    const result: VrCommandResult = {
      reply: vrSeasonLockedMessage(translate),
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, result);
    return result;
  }

  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  const noConfirm: VrCommandResult = {
    reply: translate("errors.noConfirm"),
    pending: null,
    action: { type: "none" as const },
  };
  if (
    pendingRow?.allianceId !== input.allianceId ||
    !isVrAnomalyConfirmPending(pending) ||
    pending.seasonKey !== season.seasonKey
  ) {
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, noConfirm);
    return noConfirm;
  }

  let ashedMemberId = pending.ashedMemberId ?? null;
  let commanderId = pending.commanderId ?? null;
  let identityOk = true;
  if (pending.commanderId) {
    const membership = await getCommanderMembershipInAlliance(
      pending.commanderId,
      input.allianceId,
    );
    if (
      !membership?.ashedMemberId ||
      (pending.ashedMemberId &&
        membership.ashedMemberId !== pending.ashedMemberId)
    ) {
      identityOk = false;
    } else {
      ashedMemberId = membership.ashedMemberId;
    }
  }
  if (identityOk && pending.ashedMemberId) {
    const commander = await getCommanderByAshedMemberId(
      pending.ashedMemberId,
      input.allianceId,
    );
    if (
      !commander ||
      (pending.commanderId && commander.commanderId !== pending.commanderId)
    ) {
      identityOk = false;
    } else {
      commanderId = commander.commanderId;
    }
  }
  if (!identityOk || !ashedMemberId || !commanderId) {
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, noConfirm);
    return noConfirm;
  }
  const memberLinks = await listDiscordLinksForUser(
    input.allianceId,
    input.discordUserId,
    { followLiveRoster: false },
  );
  if (!memberLinks.some((link) => link.ashedMemberId === ashedMemberId)) {
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, noConfirm);
    return noConfirm;
  }

  const result = await runWithActivityErrors(translate, async () => {
    const processed = processVrConfirmation({
      answer: input.answer,
      pending,
      translate,
      seasonKey: season.seasonKey,
    });

    if (processed.action.type === "set_vr") {
      const seasonHigh = await getMemberSeasonHigh(
        input.allianceId,
        ashedMemberId,
        season.seasonKey,
      );
      await upsertMemberSeasonVr({
        allianceId: input.allianceId,
        ashedMemberId,
        commanderId,
        seasonKey: season.seasonKey,
        baseVr: processed.action.vr,
        discordUserId: input.discordUserId,
        flagReason: processed.action.flagReason ?? null,
        eventSource: "discord",
        activity: {
          identity: { kind: "discord", discordUserId: input.discordUserId },
          expectedPreviousBaseVr: seasonHigh,
          pending: { expected: pending, required: true },
        },
      });
      const commander = await getCommanderByAshedMemberId(
        ashedMemberId,
        input.allianceId,
      );
      const instituteLevel =
        instituteLevelForBaseVr(season.seasonKey, processed.action.vr) ?? "?";
      const effectiveVr = effectiveBaseVr(
        processed.action.vr,
        commander?.weeklyPassActive ?? false,
      );
      processed.reply = translate("vr.success", {
        level: instituteLevel,
        effectiveVr,
      });
      return processed;
    }

    await saveDiscordBotPending(
      input.allianceId,
      input.discordUserId,
      processed.pending,
    );
    return processed;
  });

  await audit(input.allianceId, input.discordUserId, "vr_confirm", input, result);
  return applyVrSandboxReply(result, season, translate);
}

export async function handleDiscordLinkStartOver(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
}) {
  const { translate } = botContext(input.locale);
  const result: LinkCommandResult = {
    reply: translate("link.walkthroughDone"),
    pending: null,
  };
  await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
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
