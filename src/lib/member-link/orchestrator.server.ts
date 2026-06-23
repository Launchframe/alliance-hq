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
  createMemberLinkTranslator,
  memberLinkWalkthroughSteps,
} from "@/lib/member-link/translate.server";
import {
  processLinkCommand,
  processLinkFuzzyPick,
} from "@/lib/vr/link-command";
import { walkthroughMessage } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import { getAllianceById, getLinkedMemberIds } from "@/lib/vr/repository";
import type { LinkCommandResult, LinkPendingState } from "@/lib/vr/types";

type FlowContext = {
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
};

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
    return persistHqLinkTarget(ctx, result.linkTarget);
  }

  if (result.pending) {
    await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, result.pending);
  } else {
    await saveHqMemberLinkPending(ctx.allianceId, ctx.hqUserId, null);
  }

  if (result.needsOfficerAttention) {
    await emitLinkAttention(ctx);
  }

  return toMemberLinkApiResponse(result);
}

export async function runWebMemberLinkSubmit(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  reportedName?: string;
  gameUid?: string;
}): Promise<MemberLinkApiResponse> {
  const ctx: FlowContext = {
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
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
      return toMemberLinkApiResponse(result, { walkthroughDone: true });
    }
    return finalizeCommandResult(ctx, result);
  }

  if (!name || !uid) {
    return toMemberLinkApiResponse(
      { reply: translate("link.usage"), pending: null },
      { usage: true },
    );
  }

  const lookup = await lookupPlayerByUid(uid);
  if (!lookup.ok) {
    await saveHqMemberLinkPending(input.allianceId, input.hqUserId, null);
    return toMemberLinkApiResponse(
      { reply: lookup.message, pending: null },
      { lookupError: true },
    );
  }

  const [members, linkedMemberIds, alliance] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getLinkedMemberIds(input.allianceId),
    getAllianceById(input.allianceId),
  ]);

  const result = processLinkCommand({
    reportedName: name,
    gameUid: uid,
    lookup,
    members,
    linkedMemberIds,
    pending,
    translate,
    walkthroughSteps,
    allianceTag: alliance?.tag ?? null,
  });

  return finalizeCommandResult(ctx, result);
}

export async function runWebMemberLinkWalkthroughDone(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const ctx: FlowContext = {
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  };

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
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
  memberId: string;
}): Promise<MemberLinkApiResponse> {
  const ctx: FlowContext = {
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  };

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
  allianceId: string;
  hqUserId: string;
  locale: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<MemberLinkApiResponse> {
  const ctx: FlowContext = {
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    locale: input.locale,
    userEmail: input.userEmail,
    displayName: input.displayName,
  };
  await emitLinkAttention(ctx);
  const translate = createMemberLinkTranslator(input.locale);
  return {
    outcome: "officer_notified",
    message: translate("officerNotified"),
    pending: null,
  };
}

export async function getWebMemberLinkStatus(input: {
  allianceId: string;
  hqUserId: string;
  locale: string;
}) {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  const pendingRow = await getHqMemberLinkPending(input.allianceId, input.hqUserId);
  return {
    linked: link != null,
    link,
    pending: pendingRow?.pending ?? null,
  };
}
