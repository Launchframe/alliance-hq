import "server-only";

import { emitAdminAlert } from "@/lib/events/admin-alerts";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { syncAllianceMemberGameLevelFromLastWar } from "@/lib/lastwar/sync-member-game-level.server";
import {
  getHqMemberLinkForUser,
  getHqMemberLinkPending,
  linkHqMember,
  saveHqMemberLinkPending,
  syncPrimaryGameUidFromHqMemberLink,
} from "@/lib/member-link/repository.server";
import {
  toMemberLinkApiResponse,
  type MemberLinkApiResponse,
} from "@/lib/member-link/outcome.shared";
import {
  assertPrivilegedAshedGate,
} from "@/lib/member-link/privileged-link.server";
import {
  tryRouteRosterMissToOwnerApproval,
  getRosterLinkRequestById,
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
import { walkthroughMessage } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForMemberLink } from "@/lib/vr/member-roster";
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

function ashedVerificationRequiredResponse(
  locale: string,
): MemberLinkApiResponse {
  const { translate } = translateContext(locale);
  return {
    outcome: "ashed_verification_required",
    message: translate("errors.ashedVerificationRequired"),
    pending: null,
  };
}

async function assertWebMemberLinkAllowed(
  ctx: FlowContext,
): Promise<MemberLinkApiResponse | null> {
  const rbac = await getRbacContext(ctx.sessionId);
  const gate = await assertPrivilegedAshedGate({
    sessionId: ctx.sessionId,
    hqUserId: ctx.hqUserId,
    roleName: rbac?.roleName,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
  });
  if (!gate.ok) {
    return ashedVerificationRequiredResponse(ctx.locale);
  }
  return null;
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
    return toMemberLinkApiResponse(
      { reply: translate("link.memberTaken"), pending: null },
      { memberTaken: true },
    );
  }

  ctx.auditBag.ashedMemberId = linkTarget.ashedMemberId;

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

export async function runWebMemberLinkSubmit(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  reportedName?: string;
  gameUid?: string;
}): Promise<MemberLinkApiResponse> {
  const ctx: FlowContext = {
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
    auditBag: createAuditBag(),
  };

  const gateBlocked = await assertWebMemberLinkAllowed(ctx);
  if (gateBlocked) {
    return finishMemberLinkSubmit(ctx, gateBlocked);
  }

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

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok) {
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
    return finishMemberLinkSubmit(
      ctx,
      toMemberLinkApiResponse(
        { reply: lookup.message, pending: null },
        { lookupError: true },
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

  if (result.needsOfficerAttention) {
    const routed = await tryRouteRosterMissToOwnerApproval({
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      locale: input.locale,
      reportedName: name,
      gameUid: uid,
      lookup,
    });
    if (routed) {
      return finishMemberLinkSubmit(ctx, routed);
    }
  }

  return finishMemberLinkSubmit(ctx, await finalizeCommandResult(ctx, result));
}

export async function runWebMemberLinkWalkthroughDone(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
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
  const ctx = createFlowContext({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  });

  const gateBlocked = await assertWebMemberLinkAllowed(ctx);
  if (gateBlocked) {
    return gateBlocked;
  }

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

export async function runWebMemberLinkAskOfficer(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const ctx = createFlowContext({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  });

  const gate = await assertWebMemberLinkAllowed(ctx);
  if (gate) {
    return gate;
  }

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
  if (pendingRow?.pending?.kind !== "link_roster_miss") {
    const translate = createMemberLinkTranslator(input.locale);
    return {
      outcome: "usage",
      message: translate("errors.nothingPending"),
      pending: null,
    };
  }

  await emitLinkAttention(ctx);
  await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
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
  const requiresAshedVerification =
    (await assertPrivilegedAshedGate({
      sessionId: input.sessionId,
      hqUserId: input.hqUserId,
      roleName: rbac?.roleName,
      isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
    })).ok === false;

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

  return {
    linked: effectiveLink != null,
    link: effectiveLink,
    pending,
    requiresAshedVerification,
    privilegedRole: rbac?.roleName ?? null,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
  };
}
