import "server-only";

import { emitAdminAlert, emitMemberLinkUidTakenAlert } from "@/lib/events/admin-alerts";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import {
  getHqMemberLinkForUser,
  getHqMemberLinkPending,
  linkHqMember,
  maybeSetOwnerMemberExternalId,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import {
  toMemberLinkApiResponse,
  type MemberLinkApiResponse,
} from "@/lib/member-link/outcome.shared";
import {
  blockSelfServiceWhenClaimPending,
  getMemberLinkClaimTarget,
} from "@/lib/member-link/claim.server";
import {
  tryBootstrapOwnerColdStartMember,
  tryRouteRosterMissToOwnerApproval,
  getRosterLinkRequestById,
  isOwnerColdStartEligible,
} from "@/lib/member-link/roster-link-request.server";
import {
  createMemberLinkTranslator,
  memberLinkWalkthroughSteps,
} from "@/lib/member-link/translate.server";
import {
  recordMemberLinkSubmit,
} from "@/lib/onboarding/onboarding-audit.server";
import { getRbacContext } from "@/lib/rbac/context";
import {
  processLinkCommand,
  processLinkFuzzyPick,
} from "@/lib/vr/link-command";
import {
  walkthroughMessage,
  namesMatch,
  findUniqueSubstringRosterCandidate,
} from "@/lib/vr/link-helpers";
import { loadAllianceMembersForMemberLink, loadAllianceMembersForMemberLinkWithLiveRetry } from "@/lib/vr/member-roster";
import type { MemberLinkRosterSource } from "@/lib/vr/member-roster";
import { getAllianceById, getLinkedMemberIds } from "@/lib/vr/repository";
import type { LinkCommandResult, LinkPendingState } from "@/lib/vr/types";

type MemberLinkSubmitAuditBag = {
  rosterSource: MemberLinkRosterSource;
  rosterCount: number;
  ashedMemberId?: string;
};

type FlowContext = {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  auditBag: MemberLinkSubmitAuditBag;
};

function createAuditBag(): MemberLinkSubmitAuditBag {
  return { rosterSource: "not_loaded", rosterCount: 0 };
}

function createFlowContext(
  input: Omit<FlowContext, "auditBag">,
): FlowContext {
  return { ...input, auditBag: createAuditBag() };
}

async function finishMemberLinkSubmit(
  ctx: FlowContext,
  response: MemberLinkApiResponse,
): Promise<MemberLinkApiResponse> {
  await recordMemberLinkSubmit({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    hqUserId: ctx.hqUserId,
    outcome: response.outcome,
    rosterSource: ctx.auditBag.rosterSource,
    rosterCount: ctx.auditBag.rosterCount,
    ashedMemberId: ctx.auditBag.ashedMemberId,
  });
  return response;
}

function translateContext(locale: string) {
  const translate = createMemberLinkTranslator(locale);
  const walkthroughSteps = memberLinkWalkthroughSteps(locale);
  return { translate, walkthroughSteps };
}

async function emitLinkAttention(ctx: FlowContext) {
  const handle = ctx.displayName?.trim() || ctx.userEmail?.trim() || ctx.hqUserId;
  await emitAdminAlert({
    type: "vr_link_attention",
    count: 1,
    handles: [handle],
  });
}

async function persistHqLinkTarget(
  ctx: FlowContext,
  linkTarget: NonNullable<LinkCommandResult["linkTarget"]>,
): Promise<MemberLinkApiResponse> {
  const { translate } = translateContext(ctx.locale);
  const linked = await linkHqMember({
    allianceId: ctx.allianceId,
    hqUserId: ctx.hqUserId,
    ashedMemberId: linkTarget.ashedMemberId,
    memberDisplayName: linkTarget.memberDisplayName,
    gameUid: linkTarget.gameUid,
  });

  if (!linked.ok) {
    const handle =
      ctx.displayName?.trim() || ctx.userEmail?.trim() || ctx.hqUserId;
    const alliance = await getAllianceById(ctx.allianceId);
    try {
      await emitMemberLinkUidTakenAlert({
        allianceId: ctx.allianceId,
        allianceTag: alliance?.tag ?? "alliance",
        ashedMemberId: linkTarget.ashedMemberId,
        hqUserId: ctx.hqUserId,
        handle,
      });
    } catch (error) {
      console.error("[member-link] uid-taken admin alert failed", error);
    }
    return toMemberLinkApiResponse(
      { reply: translate("link.memberTaken"), pending: null },
      { memberTaken: true },
    );
  }

  ctx.auditBag.ashedMemberId = linkTarget.ashedMemberId;

  // Persist the owner's member identity so Discord /link-alliance owner proof
  // (callerOwnsAllianceViaMemberLink) can verify without Ashed credentials.
  try {
    await maybeSetOwnerMemberExternalId({
      allianceId: ctx.allianceId,
      hqUserId: ctx.hqUserId,
      ashedMemberId: linkTarget.ashedMemberId,
    });
  } catch (error) {
    console.error("[member-link] owner externalId sync failed", error);
  }

  await syncPrimaryGameUidFromHqMemberLink(ctx.hqUserId, linkTarget.gameUid);

  if (linkTarget.gameUserLevel != null) {
    try {
      await syncAllianceMemberGameLevelFromLastWar({
        allianceId: ctx.allianceId,
        ashedMemberId: linkTarget.ashedMemberId,
        gameUserLevel: linkTarget.gameUserLevel,
      });
    } catch (error) {
      console.error("[member-link] level sync failed", error);
    }
  }

  const mode = linked.mode === "updated" ? "updated" : "linked";
  const reply =
    mode === "updated"
      ? translate("link.updated", { name: linkTarget.memberDisplayName })
      : translate("link.linked", { name: linkTarget.memberDisplayName });

  return toMemberLinkApiResponse({
    reply,
    pending: null,
    linked: true,
    linkTarget,
  });
}

async function finalizeCommandResult(
  ctx: FlowContext,
  result: LinkCommandResult,
): Promise<MemberLinkApiResponse> {
  if (result.linkTarget) {
    await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, null);
    if (result.needsOfficerAttention) {
      await emitLinkAttention(ctx);
    }
    const [rosterLoad] = await Promise.all([
      loadAllianceMembersForMemberLink(ctx.allianceId),
      getAllianceById(ctx.allianceId),
    ]);
    ctx.auditBag.rosterSource = rosterLoad.rosterSource;
    ctx.auditBag.rosterCount = rosterLoad.members.length;
    return persistHqLinkTarget(ctx, result.linkTarget);
  }

  if (result.pending) {
    await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, result.pending);
  } else {
    const response = toMemberLinkApiResponse(result);
    if (response.outcome === "roster_miss") {
      await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, {
        kind: "link_roster_miss",
      });
    } else {
      await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, null);
    }
  }

  if (result.needsOfficerAttention) {
    await emitLinkAttention(ctx);
  }

  return toMemberLinkApiResponse(result);
}

/**
 * UID-only self-service step 1: look up the player by UID and return the game
 * name for the user to confirm before any link is written. The typed-name
 * requirement was dropped (it never drove roster matching — that uses the
 * looked-up `gameUserName`), so this preview replaces it with an explicit
 * "is this you?" confirmation that still catches UID typos. The confirm step
 * then re-runs the normal submit with `reportedName = gameUserName`, so every
 * downstream branch (roster match, roster miss, owner approval, cold start,
 * server confirm, member-taken) is unchanged.
 */
export async function runWebMemberLinkPreview(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  gameUid?: string;
}): Promise<MemberLinkApiResponse> {
  const claimBlock = await blockSelfServiceWhenClaimPending({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
  });
  if (claimBlock) {
    return claimBlock;
  }

  const translate = createMemberLinkTranslator(input.locale);
  const uid = input.gameUid?.trim();
  if (!uid) {
    return {
      outcome: "lookup_error",
      message: translate("link.usage"),
      pending: null,
    };
  }

  const lookup = await lookupPlayerByUid(uid);
  if (lookup.ok) {
    return {
      outcome: "confirm_identity",
      message: lookup.gameUserName,
      pending: null,
      lookupGameUserName: lookup.gameUserName,
      lookupServerNumber: lookup.gameServerNumber ?? null,
    };
  }

  // Degraded mode: owner bootstrapping an empty roster while the game API is
  // unreachable still needs the manual name + server fallback (no name to
  // confirm). Everyone else just retries the UID lookup.
  if (lookup.reason === "request_failed") {
    const roster = await loadAllianceMembersForMemberLink(input.allianceId);
    const ownerColdStartEligible = await isOwnerColdStartEligible({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      rosterCount: roster.members.length,
    });
    if (ownerColdStartEligible) {
      return {
        outcome: "lookup_fallback",
        message: translate("lookupFallback"),
        pending: null,
      };
    }
  }

  return {
    outcome: "lookup_error",
    message: lookup.message,
    pending: null,
  };
}

export async function runWebMemberLinkSubmit(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  reportedName?: string;
  gameUid?: string;
  ownerProvidedServerNumber?: number;
  ownerLookupFallback?: boolean;
}): Promise<MemberLinkApiResponse> {
  const claimBlock = await blockSelfServiceWhenClaimPending({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
  });
  if (claimBlock) {
    return claimBlock;
  }

  const ctx: FlowContext = {
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
    auditBag: createAuditBag(),
  };

  const { translate, walkthroughSteps } = translateContext(input.locale);
  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
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
    const walkthroughDoneText = translate("link.walkthroughDone");
    if (result.pending === null && result.reply === walkthroughDoneText) {
      await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
      return finishMemberLinkSubmit(
        ctx,
        toMemberLinkApiResponse(result, { walkthroughDone: true }),
      );
    }
    return finishMemberLinkSubmit(ctx, await finalizeCommandResult(ctx, result));
  }

  if (!name || !uid) {
    return finishMemberLinkSubmit(
      ctx,
      toMemberLinkApiResponse(
        { reply: translate("link.usage"), pending: null },
        { usage: true },
      ),
    );
  }

  const [rosterLoad, linkedMemberIds, alliance] = await Promise.all([
    loadAllianceMembersForMemberLink(input.allianceId),
    getLinkedMemberIds(input.allianceId),
    getAllianceById(input.allianceId),
  ]);
  ctx.auditBag.rosterSource = rosterLoad.rosterSource;
  ctx.auditBag.rosterCount = rosterLoad.members.length;

  const ownerColdStartEligible = await isOwnerColdStartEligible({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    rosterCount: rosterLoad.members.length,
  });

  const linkHandle =
    input.displayName?.trim() || input.userEmail?.trim() || input.hqUserId;

  if (
    input.ownerLookupFallback &&
    input.ownerProvidedServerNumber != null &&
    ownerColdStartEligible
  ) {
    const bootstrapped = await tryBootstrapOwnerColdStartMember({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      locale: input.locale,
      reportedName: name,
      gameUid: uid,
      lookup: {
        ok: true,
        gameUserName: name,
        gameServerNumber: input.ownerProvidedServerNumber,
      },
      rosterCount: rosterLoad.members.length,
      sessionId: input.sessionId,
      auditBag: ctx.auditBag,
      ownerProvidedServerNumber: input.ownerProvidedServerNumber,
      handle: linkHandle,
    });
    if (bootstrapped) {
      return finishMemberLinkSubmit(ctx, bootstrapped);
    }
  }

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok) {
    if (lookup.reason === "request_failed" && ownerColdStartEligible) {
      await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
      return finishMemberLinkSubmit(ctx, {
        outcome: "lookup_fallback",
        message: translate("lookupFallback"),
        pending: null,
      });
    }
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
    return finishMemberLinkSubmit(
      ctx,
      toMemberLinkApiResponse(
        { reply: lookup.message, pending: null },
        { lookupError: true },
      ),
    );
  }

  if (!namesMatch(name, lookup.gameUserName)) {
    return finishMemberLinkSubmit(ctx, {
      outcome: "name_mismatch",
      message: translate("nameMismatchRetry", { gameName: lookup.gameUserName }),
      pending: null,
      lookupGameUserName: lookup.gameUserName,
    });
  }

  const result = processLinkCommand({
    reportedName: name,
    gameUid: uid,
    lookup,
    members: rosterLoad.members,
    linkedMemberIds,
    pending,
    translate,
    walkthroughSteps,
    allianceTag: alliance?.tag ?? null,
  });

  let resolvedResult = result;
  let finalRosterMembers = rosterLoad.members;
  if (result.needsOfficerAttention) {
    const refreshed = await loadAllianceMembersForMemberLinkWithLiveRetry(
      input.allianceId,
      lookup.gameUserName,
    );
    if (refreshed.members !== rosterLoad.members) {
      ctx.auditBag.rosterSource = refreshed.rosterSource;
      ctx.auditBag.rosterCount = refreshed.members.length;
      finalRosterMembers = refreshed.members;
      const retried = processLinkCommand({
        reportedName: name,
        gameUid: uid,
        lookup,
        members: refreshed.members,
        linkedMemberIds,
        pending,
        translate,
        walkthroughSteps,
        allianceTag: alliance?.tag ?? null,
      });
      if (!retried.needsOfficerAttention) {
        resolvedResult = retried;
      }
    }
  }

  if (resolvedResult.needsOfficerAttention) {
    const bootstrapped = await tryBootstrapOwnerColdStartMember({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      locale: input.locale,
      reportedName: name,
      gameUid: uid,
      lookup,
      rosterCount: rosterLoad.members.length,
      sessionId: input.sessionId,
      auditBag: ctx.auditBag,
      ownerProvidedServerNumber: input.ownerProvidedServerNumber,
      handle: linkHandle,
    });
    if (bootstrapped) {
      return finishMemberLinkSubmit(ctx, bootstrapped);
    }

    const suggestion = findUniqueSubstringRosterCandidate(
      finalRosterMembers,
      lookup.gameUserName,
    );

    const routed = await tryRouteRosterMissToOwnerApproval({
      allianceId: input.allianceId,
      allianceTag: alliance?.tag ?? "alliance",
      hqUserId: input.hqUserId,
      locale: input.locale,
      reportedName: name,
      gameUid: uid,
      lookup,
      suggestedTargetAshedMemberId: suggestion?.ashedMemberId ?? null,
      suggestionMethod: suggestion?.method ?? null,
      suggestedMatchedRosterName: suggestion?.matchedRosterName ?? null,
    });
    if (routed) {
      return finishMemberLinkSubmit(ctx, routed);
    }
  }

  return finishMemberLinkSubmit(ctx, await finalizeCommandResult(ctx, resolvedResult));
}

export async function runWebMemberLinkWalkthroughDone(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const claimBlock = await blockSelfServiceWhenClaimPending({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
  });
  if (claimBlock) {
    return claimBlock;
  }

  const ctx = createFlowContext({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  });

  const { translate, walkthroughSteps } = translateContext(input.locale);
  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
  const pending = pendingRow?.pending;

  if (!pending || pending.kind !== "link_walkthrough") {
    return toMemberLinkApiResponse({
      reply: translate("errors.noWalkthrough"),
      pending: null,
    });
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

  if (isWalkthroughComplete(result, translate)) {
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
    return toMemberLinkApiResponse(result, { walkthroughDone: true });
  }

  return finalizeCommandResult(ctx, result);
}

function isWalkthroughComplete(
  result: LinkCommandResult,
  translate: ReturnType<typeof createMemberLinkTranslator>,
): boolean {
  return (
    result.pending === null &&
    !result.linked &&
    result.reply === translate("link.walkthroughDone")
  );
}

export async function runWebMemberLinkStartOver(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
}): Promise<MemberLinkApiResponse> {
  const claimBlock = await blockSelfServiceWhenClaimPending({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
  });
  if (claimBlock) {
    return claimBlock;
  }

  const { translate, walkthroughSteps } = translateContext(input.locale);
  const pending: LinkPendingState = { kind: "link_walkthrough", step: 0 };
  const result: LinkCommandResult = {
    reply: walkthroughMessage(0, translate, walkthroughSteps),
    pending,
  };
  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, pending);
  return toMemberLinkApiResponse(result);
}

export async function runWebMemberLinkFuzzyPick(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  memberId: string;
}): Promise<MemberLinkApiResponse> {
  const claimBlock = await blockSelfServiceWhenClaimPending({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
  });
  if (claimBlock) {
    return claimBlock;
  }

  const ctx = createFlowContext({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  });

  const { translate } = translateContext(input.locale);
  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
  const pending = pendingRow?.pending;

  if (!pending || pending.kind !== "link_fuzzy_pick") {
    return toMemberLinkApiResponse(
      { reply: translate("errors.nothingPending"), pending: null },
      { pickExpired: true },
    );
  }

  const result = processLinkFuzzyPick({
    pending,
    memberId: input.memberId,
    translate,
  });

  if (!result.linkTarget) {
    return toMemberLinkApiResponse(result, {
      pickExpired: result.reply === translate("link.pickExpired"),
    });
  }

  return finalizeCommandResult(ctx, result);
}

function isValidMemberLinkGameUid(value: string): boolean {
  return /^\d{12,16}$/.test(value);
}

export async function runWebMemberLinkAskOfficer(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  reportedName?: string | null;
  gameUid?: string | null;
}): Promise<MemberLinkApiResponse> {
  const ctx = createFlowContext({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  });

  const existingLink = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (existingLink) {
    const translate = createMemberLinkTranslator(input.locale);
    return {
      outcome: "usage",
      message: translate("errors.nothingPending"),
      pending: null,
    };
  }

  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
  const pending = pendingRow?.pending ?? null;
  const pendingAllowsAskOfficer =
    pending?.kind === "link_roster_miss" ||
    pending?.kind === "link_walkthrough";

  const gameUid = input.gameUid?.trim() ?? "";
  const hasHelpContext =
    pendingAllowsAskOfficer || isValidMemberLinkGameUid(gameUid);

  if (!hasHelpContext) {
    const translate = createMemberLinkTranslator(input.locale);
    return {
      outcome: "usage",
      message: translate("errors.nothingPending"),
      pending: null,
    };
  }

  await emitLinkAttention(ctx);
  if (pendingAllowsAskOfficer) {
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
  }
  const translate = createMemberLinkTranslator(input.locale);
  return {
    outcome: "officer_notified",
    message: translate("officerNotified"),
    pending: null,
  };
}

export async function getWebMemberLinkStatus(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
}) {
  const rbac = await getRbacContext(input.sessionId);

  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
  let pending = pendingRow?.pending ?? null;

  if (
    !link &&
    pending?.kind === "link_awaiting_owner"
  ) {
    const request = await getRosterLinkRequestById(pending.requestId);
    if (request?.status === "accepted") {
      const refreshedLink = await getHqMemberLinkForUser(
        input.allianceId,
        input.hqUserId,
      );
      if (refreshedLink) {
        await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
        pending = null;
      }
    } else if (request?.status === "rejected" || request?.status === "superseded") {
      await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
      pending = null;
    }
  }

  const effectiveLink =
    link ??
    (pending?.kind === "link_awaiting_owner"
      ? await getHqMemberLinkForUser(input.allianceId, input.hqUserId)
      : null);

  const claimTarget =
    effectiveLink == null
      ? await getMemberLinkClaimTarget({
          allianceId: input.allianceId,
          hqUserId: input.hqUserId,
        })
      : null;

  return {
    linked: effectiveLink != null,
    link: effectiveLink,
    pending,
    claimTarget,
    privilegedRole: rbac?.roleName ?? null,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
  };
}
