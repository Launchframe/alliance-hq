import "server-only";

import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import type { DiscordBotLocale } from "@/lib/discord/i18n";
import { createDiscordTranslator } from "@/lib/discord/i18n";
import { decideNameMatch } from "@/lib/performance-notes/match.shared";
import { splitCommanderNames } from "@/lib/performance-notes/names.shared";
import type { PerformanceNotesPendingState } from "@/lib/performance-notes/pending-state";
import {
  attachMembersToPerformanceNote,
  createPerformanceNote,
  getPerformanceNoteForAlliance,
} from "@/lib/performance-notes/repository.server";
import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
import {
  getAllianceById,
  getDiscordHqLink,
  saveDiscordBotPending,
} from "@/lib/vr/repository";

export type PerfDiscordComponents = Array<{
  type: number;
  components: Array<{
    type: number;
    style?: number;
    label?: string;
    custom_id: string;
  }>;
}>;

export type PerfInteractionResult =
  | {
      type: "message";
      content: string;
      components?: PerfDiscordComponents;
      update?: boolean;
    }
  | {
      type: "modal";
      customId: string;
      title: string;
      fieldCustomId: string;
      fieldLabel: string;
      paragraph?: boolean;
      maxLength?: number;
    };

function yesNoButtons(
  t: ReturnType<typeof createDiscordTranslator>,
  yesId: string,
  noId: string,
): PerfDiscordComponents {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: t("buttons.yes").slice(0, 80),
          custom_id: yesId,
        },
        {
          type: 2,
          style: 4,
          label: t("buttons.no").slice(0, 80),
          custom_id: noId,
        },
      ],
    },
  ];
}

function pickButtons(
  candidates: Array<{ memberId: string; name: string }>,
  includeSkip: boolean,
  skipLabel: string,
): PerfDiscordComponents {
  const picks = candidates.slice(0, 5).map((candidate, index) => ({
    type: 2,
    style: 1,
    label: candidate.name.slice(0, 80),
    custom_id: `note:pick:${index}`,
  }));
  const rows: PerfDiscordComponents = [{ type: 1, components: picks }];
  if (includeSkip) {
    rows.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: skipLabel.slice(0, 80),
          custom_id: "note:skip",
        },
      ],
    });
  }
  return rows;
}

function noteUrl(locale: DiscordBotLocale, noteId: string): string {
  return buildDiscordBotAppUrl(locale, `/notes/${noteId}`);
}

async function officerGuard(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<{ ok: true; allianceId: string } | { ok: false; result: PerfInteractionResult }> {
  const t = createDiscordTranslator(input.locale);
  if (!input.allianceId) {
    return {
      ok: false,
      result: { type: "message", content: t("errors.guildNotRegistered") },
    };
  }
  const allowed = await callerCanRunVrReport({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!allowed) {
    return {
      ok: false,
      result: { type: "message", content: t("errors.notOfficer") },
    };
  }
  return { ok: true, allianceId: input.allianceId };
}

async function hqUserIdForDiscord(discordUserId: string): Promise<string | null> {
  const link = await getDiscordHqLink(discordUserId);
  return link?.hqUserId ?? null;
}

function memberModal(t: ReturnType<typeof createDiscordTranslator>): PerfInteractionResult {
  return {
    type: "modal",
    customId: "note:member-modal",
    title: t("performanceNotes.memberModalTitle").slice(0, 45),
    fieldCustomId: "member",
    fieldLabel: t("performanceNotes.memberModalLabel").slice(0, 45),
    maxLength: 80,
  };
}

function reasonModal(
  t: ReturnType<typeof createDiscordTranslator>,
  command: "commend" | "violation",
): PerfInteractionResult {
  const title =
    command === "commend"
      ? t("performanceNotes.commendReasonPrompt")
      : t("performanceNotes.violationReasonPrompt");
  return {
    type: "modal",
    customId: "note:reason-modal",
    title: title.slice(0, 45),
    fieldCustomId: "reason",
    fieldLabel: title.slice(0, 45),
    paragraph: true,
    maxLength: 2000,
  };
}

function attachAskMessage(
  t: ReturnType<typeof createDiscordTranslator>,
  locale: DiscordBotLocale,
  noteId: string,
): PerfInteractionResult {
  return {
    type: "message",
    content: t("performanceNotes.savedAskAttach", { url: noteUrl(locale, noteId) }),
    components: yesNoButtons(t, "note:attach:yes", "note:attach:no"),
  };
}

function doneViewing(
  t: ReturnType<typeof createDiscordTranslator>,
  locale: DiscordBotLocale,
  noteId: string,
  update?: boolean,
): PerfInteractionResult {
  return {
    type: "message",
    content: t("performanceNotes.doneView", { url: noteUrl(locale, noteId) }),
    update,
  };
}

function addAnotherAsk(
  t: ReturnType<typeof createDiscordTranslator>,
  update?: boolean,
): PerfInteractionResult {
  return {
    type: "message",
    content: t("performanceNotes.addAnother"),
    components: yesNoButtons(t, "note:another:yes", "note:another:no"),
    update,
  };
}

async function continueBatchAfterResolved(input: {
  allianceId: string;
  discordUserId: string;
  locale: DiscordBotLocale;
  command: "commend" | "violation";
  resolved: Array<{ memberId: string; nameRaw: string }>;
  remaining: string[];
  update?: boolean;
}): Promise<PerfInteractionResult> {
  const t = createDiscordTranslator(input.locale);
  const alliance = await getAllianceById(input.allianceId);
  const members = await loadAllianceMembersForBot(input.allianceId);

  const resolved = [...input.resolved];
  const leftover = [...input.remaining];
  while (leftover.length > 0) {
    const token = leftover.shift()!;
    const decision = decideNameMatch(token, members, alliance?.tag);
    if (decision.action === "auto") {
      resolved.push({ memberId: decision.memberId, nameRaw: token });
      continue;
    }
    if (decision.action === "clarify") {
      await saveDiscordBotPending(input.allianceId, input.discordUserId, {
        kind: "perf_batch_clarify",
        command: input.command,
        resolved,
        remaining: leftover,
        currentToken: decision.token,
        candidates: decision.candidates,
      });
      return {
        type: "message",
        content: t("performanceNotes.clarify", { token: decision.token }),
        components: pickButtons(
          decision.candidates,
          true,
          t("performanceNotes.skip"),
        ),
        update: input.update,
      };
    }
    await saveDiscordBotPending(input.allianceId, input.discordUserId, {
      kind: "perf_batch_clarify",
      command: input.command,
      resolved,
      remaining: leftover,
      currentToken: token,
      candidates: [],
    });
    return {
      type: "message",
      content: t("performanceNotes.noMatch", { token }),
      components: pickButtons([], true, t("performanceNotes.skip")),
      update: input.update,
    };
  }

  if (resolved.length === 0) {
    await saveDiscordBotPending(input.allianceId, input.discordUserId, null);
    return {
      type: "message",
      content: t("performanceNotes.batchEmpty"),
      update: input.update,
    };
  }

  await saveDiscordBotPending(input.allianceId, input.discordUserId, {
    kind: "perf_batch_reason",
    command: input.command,
    resolved,
  });
  return reasonModal(t, input.command);
}

export async function handlePerformanceNoteSlash(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  text: string | undefined;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  const body = input.text?.trim() ?? "";
  if (!body) {
    return { type: "message", content: t("performanceNotes.emptyText") };
  }
  const hqUserId = await hqUserIdForDiscord(input.discordUserId);
  const noteId = await createPerformanceNote({
    allianceId: gated.allianceId,
    kind: "note",
    intakeMode: "thought",
    body,
    source: "discord",
    createdByDiscordUserId: input.discordUserId,
    createdByHqUserId: hqUserId,
  });
  await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
    kind: "perf_note_attach",
    noteId,
  });
  return attachAskMessage(t, input.locale, noteId);
}

export async function handlePerformanceBatchSlash(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  command: "commend" | "violation";
  names: string | undefined;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  const tokens = splitCommanderNames(input.names ?? "");
  if (tokens.length === 0) {
    return { type: "message", content: t("performanceNotes.emptyNames") };
  }
  return continueBatchAfterResolved({
    allianceId: gated.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    command: input.command,
    resolved: [],
    remaining: tokens,
  });
}

export async function handlePerformanceNoteAttachChoice(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  pending: PerformanceNotesPendingState | null;
  attach: boolean;
  update?: boolean;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  const noteId =
    input.pending?.kind === "perf_note_attach" ||
    input.pending?.kind === "perf_note_clarify"
      ? input.pending.noteId
      : null;
  if (!noteId) {
    return { type: "message", content: t("errors.nothingPending"), update: input.update };
  }
  if (!input.attach) {
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, null);
    return doneViewing(t, input.locale, noteId, input.update);
  }
  await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
    kind: "perf_note_attach",
    noteId,
  });
  return memberModal(t);
}

export async function handlePerformanceNoteMemberModal(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  pending: PerformanceNotesPendingState | null;
  memberName: string;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  const noteId =
    input.pending?.kind === "perf_note_attach" ? input.pending.noteId : null;
  if (!noteId) {
    return { type: "message", content: t("errors.nothingPending") };
  }
  const note = await getPerformanceNoteForAlliance({
    noteId,
    allianceId: gated.allianceId,
  });
  if (!note) {
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, null);
    return { type: "message", content: t("errors.nothingPending") };
  }
  const alliance = await getAllianceById(gated.allianceId);
  const members = await loadAllianceMembersForBot(gated.allianceId);
  const decision = decideNameMatch(input.memberName, members, alliance?.tag);
  if (decision.action === "auto") {
    await attachMembersToPerformanceNote({
      allianceId: gated.allianceId,
      noteId,
      members: [
        { ashedMemberId: decision.memberId, memberNameRaw: decision.memberName },
      ],
    });
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
      kind: "perf_note_attach",
      noteId,
    });
    return addAnotherAsk(t);
  }
  if (decision.action === "clarify") {
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
      kind: "perf_note_clarify",
      noteId,
      token: decision.token,
      candidates: decision.candidates,
    });
    return {
      type: "message",
      content: t("performanceNotes.clarify", { token: decision.token }),
      components: pickButtons(decision.candidates, false, ""),
    };
  }
  await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
    kind: "perf_note_attach",
    noteId,
  });
  return {
    type: "message",
    content: t("performanceNotes.noMatch", { token: decision.token }),
    components: yesNoButtons(t, "note:another:yes", "note:another:no"),
  };
}

export async function handlePerformanceNotePick(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  pending: PerformanceNotesPendingState | null;
  index: number;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  const pending = input.pending;
  if (!pending) {
    return { type: "message", content: t("errors.nothingPending"), update: true };
  }

  if (pending.kind === "perf_note_clarify") {
    const candidate = pending.candidates[input.index];
    if (!candidate) {
      return { type: "message", content: t("errors.nothingPending"), update: true };
    }
    await attachMembersToPerformanceNote({
      allianceId: gated.allianceId,
      noteId: pending.noteId,
      members: [
        { ashedMemberId: candidate.memberId, memberNameRaw: candidate.name },
      ],
    });
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, {
      kind: "perf_note_attach",
      noteId: pending.noteId,
    });
    return addAnotherAsk(t, true);
  }

  if (pending.kind === "perf_batch_clarify") {
    const candidate = pending.candidates[input.index];
    if (!candidate) {
      return { type: "message", content: t("errors.nothingPending"), update: true };
    }
    return continueBatchAfterResolved({
      allianceId: gated.allianceId,
      discordUserId: input.discordUserId,
      locale: input.locale,
      command: pending.command,
      resolved: [
        ...pending.resolved,
        { memberId: candidate.memberId, nameRaw: pending.currentToken },
      ],
      remaining: pending.remaining,
      update: true,
    });
  }

  return { type: "message", content: t("errors.nothingPending"), update: true };
}

export async function handlePerformanceNoteSkip(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  pending: PerformanceNotesPendingState | null;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  if (input.pending?.kind !== "perf_batch_clarify") {
    return { type: "message", content: t("errors.nothingPending"), update: true };
  }
  return continueBatchAfterResolved({
    allianceId: gated.allianceId,
    discordUserId: input.discordUserId,
    locale: input.locale,
    command: input.pending.command,
    resolved: input.pending.resolved,
    remaining: input.pending.remaining,
    update: true,
  });
}

export async function handlePerformanceReasonModal(input: {
  allianceId: string | null;
  discordUserId: string;
  locale: DiscordBotLocale;
  pending: PerformanceNotesPendingState | null;
  reason: string;
}): Promise<PerfInteractionResult> {
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const t = createDiscordTranslator(input.locale);
  if (input.pending?.kind !== "perf_batch_reason") {
    return { type: "message", content: t("errors.nothingPending") };
  }
  const body = input.reason.trim();
  if (!body) {
    return { type: "message", content: t("performanceNotes.emptyText") };
  }
  if (input.pending.resolved.length === 0) {
    await saveDiscordBotPending(gated.allianceId, input.discordUserId, null);
    return { type: "message", content: t("performanceNotes.batchEmpty") };
  }
  const hqUserId = await hqUserIdForDiscord(input.discordUserId);
  const kind =
    input.pending.command === "commend" ? "commendation" : "violation";
  const noteId = await createPerformanceNote({
    allianceId: gated.allianceId,
    kind,
    intakeMode: "batch",
    body,
    source: "discord",
    createdByDiscordUserId: input.discordUserId,
    createdByHqUserId: hqUserId,
  });
  const members = await loadAllianceMembersForBot(gated.allianceId);
  const nameById = new Map(members.map((member) => [member.id, member.current_name]));
  await attachMembersToPerformanceNote({
    allianceId: gated.allianceId,
    noteId,
    members: input.pending.resolved.map((row) => ({
      ashedMemberId: row.memberId,
      memberNameRaw: nameById.get(row.memberId) ?? row.nameRaw,
    })),
  });
  await saveDiscordBotPending(gated.allianceId, input.discordUserId, null);
  const ackKey =
    kind === "commendation"
      ? "performanceNotes.batchAckCommendation"
      : "performanceNotes.batchAckViolation";
  return {
    type: "message",
    content: t(ackKey, { count: input.pending.resolved.length }),
  };
}
