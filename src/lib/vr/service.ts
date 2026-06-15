import { emitAdminAlert } from "@/lib/events/admin-alerts";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";
import { processVrCommand, processVrConfirmation } from "@/lib/vr/command";
import {
  processLinkCommand,
  processLinkFuzzyPick,
} from "@/lib/vr/link-command";
import { walkthroughMessage } from "@/lib/vr/link-helpers";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  countSeasonReporters,
  getDiscordBotPending,
  getDiscordLinkById,
  getLinkedMemberIds,
  getMemberSeasonHigh,
  listDiscordLinksForUser,
  listSeasonVrRows,
  resolveSeasonKey,
  saveDiscordBotPending,
  upsertDiscordMemberLink,
  upsertMemberSeasonVr,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import type { LinkCommandResult, LinkPendingState, VrCommandResult, VrPendingState } from "@/lib/vr/types";
import { peerMaxExcludingMember } from "@/lib/vr/anomaly";

export function resolveDiscordAllianceId(): string | null {
  return process.env.DISCORD_ALLIANCE_ID?.trim() || null;
}

async function audit(
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

export async function handleDiscordLinkSlash(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string;
  reportedName?: string;
  gameUid?: string;
}): Promise<LinkCommandResult> {
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending ?? null;

  if (pending?.kind === "link_walkthrough") {
    const result = processLinkCommand({
      reportedName: "",
      gameUid: "",
      lookup: { ok: false, reason: "invalid_uid", message: "" },
      members: [],
      linkedMemberIds: new Set(),
      pending,
      walkthroughStep: pending.step,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
    await audit(input.allianceId, input.discordUserId, "link_walkthrough", {}, result);
    return result;
  }

  const name = input.reportedName?.trim();
  const uid = input.gameUid?.trim();
  if (!name || !uid) {
    const result: LinkCommandResult = {
      reply: "Usage: `/link` with your in-game name and UID (12–16 digits, ends in 1203).",
      pending: null,
    };
    await audit(input.allianceId, input.discordUserId, "link", input, result);
    return result;
  }

  const lookup = await lookupPlayerByUid(uid);
  const [members, linkedMemberIds] = await Promise.all([
    loadAllianceMembersForBot(input.allianceId),
    getLinkedMemberIds(input.allianceId),
  ]);

  const result = processLinkCommand({
    reportedName: name,
    gameUid: uid,
    lookup,
    members,
    linkedMemberIds,
    pending: pending as LinkPendingState | null,
  });

  if ("linkTarget" in result && result.linkTarget) {
    await upsertDiscordMemberLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      ashedMemberId: result.linkTarget.ashedMemberId,
      memberDisplayName: result.linkTarget.memberDisplayName,
      gameUid: result.linkTarget.gameUid,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  } else if (result.pending) {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
  } else {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
  }

  if (result.needsOfficerAttention) {
    await emitAdminAlert({
      type: "vr_link_attention",
      count: 1,
      handles: [input.discordUsername ?? input.discordUserId],
    });
  }

  await audit(input.allianceId, input.discordUserId, "link", input, result);
  return result;
}

export async function handleDiscordLinkFuzzyPick(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string;
  memberId: string;
}): Promise<LinkCommandResult> {
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (!pending || pending.kind !== "link_fuzzy_pick") {
    const result: LinkCommandResult = { reply: "Nothing to pick right now.", pending: null };
    await audit(input.allianceId, input.discordUserId, "link_pick", input, result);
    return result;
  }

  const result = processLinkFuzzyPick({ pending, memberId: input.memberId });
  if (result.linkTarget) {
    await upsertDiscordMemberLink({
      allianceId: input.allianceId,
      discordUserId: input.discordUserId,
      discordUsername: input.discordUsername,
      ashedMemberId: result.linkTarget.ashedMemberId,
      memberDisplayName: result.linkTarget.memberDisplayName,
      gameUid: result.linkTarget.gameUid,
    });
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
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
}): Promise<VrCommandResult> {
  const target = await resolveTargetLink(input);
  if (target === null) {
    const result: VrCommandResult = {
      reply:
        "Your Discord account isn't linked yet. Run `/link` with your in-game name and UID first.",
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr", input, result);
    return result;
  }
  if (target === "pick") {
    const links = await listDiscordLinksForUser(input.allianceId, input.discordUserId);
    const result: VrCommandResult = {
      reply: "Which character is this VR for?",
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

  const result = processVrCommand({
    explicitLevel: input.explicitLevel,
    seasonHigh,
    ashedMemberId: target.ashedMemberId,
    pending,
    reporterCount,
    peerMax,
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
}) {
  return handleDiscordVrSlash({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    linkId: input.linkId,
  });
}

export async function handleDiscordVrButtonConfirm(input: {
  allianceId: string;
  discordUserId: string;
  answer: "yes" | "no";
}): Promise<VrCommandResult> {
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending as VrPendingState | null;
  if (!pending || pending.kind !== "anomaly_confirm") {
    const result: VrCommandResult = {
      reply: "Nothing to confirm right now.",
      pending: null,
      action: { type: "none" as const },
    };
    await audit(input.allianceId, input.discordUserId, "vr_confirm", input, result);
    return result;
  }

  const result = processVrConfirmation({ answer: input.answer, pending });
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
}) {
  const pending: LinkPendingState = { kind: "link_walkthrough", step: 0 };
  const result: LinkCommandResult = {
    reply: walkthroughMessage(0),
    pending,
  };
  await saveDiscordBotPending(input.allianceId, input.discordUserId, pending);
  await audit(input.allianceId, input.discordUserId, "link_start_over", {}, result);
  return result;
}

export async function handleDiscordWalkthroughDone(input: {
  allianceId: string;
  discordUserId: string;
}) {
  const pendingRow = await getDiscordBotPending(input.discordUserId);
  const pending = pendingRow?.pending;
  if (!pending || pending.kind !== "link_walkthrough") {
    return { reply: "No walkthrough in progress.", pending: null };
  }

  const result = processLinkCommand({
    reportedName: "",
    gameUid: "",
    lookup: { ok: false, reason: "invalid_uid", message: "" },
    members: [],
    linkedMemberIds: new Set(),
    pending,
    walkthroughStep: pending.step,
  });

  await saveDiscordBotPending(input.allianceId, input.discordUserId, result.pending);
  await audit(input.allianceId, input.discordUserId, "link_walkthrough_done", {}, result);
  return result;
}
