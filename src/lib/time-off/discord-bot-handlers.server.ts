import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator, getDiscordBotLocale, normalizeDiscordBotLocale, type DiscordBotLocale } from "@/lib/discord/i18n";
import { interactionDiscordUserId, interactionGuildId, type DiscordInteractionPayload } from "@/lib/discord/interactions";
import { nameMatchScore } from "@/lib/video/member-matcher";
import { listDiscordLinksForStatusQuery } from "@/lib/vr/bot-member-links.server";
import { callerCanRunVrReport } from "@/lib/vr/bot-officer-auth";
import { resolveAllianceForGuild } from "@/lib/vr/service";
import { addCalendarDays, getServerCalendarDate, getWeekStartMonday } from "@/lib/trains/game-time";
import { serializeTimeOffEntry } from "./api.shared";
import { createTimeOff, updateTimeOff, cancelTimeOff, previewTimeOff } from "./mutations.server";
import { dualWriteTimeOffToAshed } from "./excused-sync.server";
import { listActiveTimeOffEntries, listOwnTimeOffPage, listTimeOffForMember, listTimeOffRoster } from "./repository.server";
import { parseTimeOffMessage } from "./parse-natural-language.shared";
import { canManageTimeOffEntry, isTimeOffDate, TimeOffError, TIME_OFF_MAX_DAYS, TIME_OFF_MAX_NOTES, type TimeOffDraft } from "./workflow.shared";
import { loadTimeOffInteraction, saveTimeOffInteraction, type TimeOffDiscordActor } from "./discord-interaction-state.server";
import { escapeTimeOffDiscordText, parseTimeOffCustomId, timeOffCustomId, type TimeOffDiscordState } from "./discord-workflow.shared";
import type { SerializedTimeOffEntry } from "./types.shared";

type Context = { actor: TimeOffDiscordActor; locale: DiscordBotLocale; requestId: string; t: ReturnType<typeof createDiscordTranslator> };
type Button = { type: number; style: number; label: string; custom_id: string };
export type TimeOffBotReply = { content: string; components?: unknown[] };

async function contextFor(payload: DiscordInteractionPayload): Promise<Context> {
  const discordUserId = interactionDiscordUserId(payload);
  const guildId = interactionGuildId(payload);
  if (!discordUserId || !guildId) throw new TimeOffError("forbidden", 403);
  if (!payload.id || !/^\d{15,25}$/.test(payload.id)) throw new TimeOffError("expired", 400);
  const allianceId = await resolveAllianceForGuild(guildId);
  if (!allianceId) throw new TimeOffError("forbidden", 403);
  const [locale, links, canManageOthers] = await Promise.all([
    getDiscordBotLocale(discordUserId, payload.locale),
    listDiscordLinksForStatusQuery(allianceId, discordUserId),
    callerCanRunVrReport({ allianceId, discordUserId }),
  ]);
  return { locale, requestId: `discord-${payload.id}`, t: createDiscordTranslator(locale), actor: { allianceId, discordUserId, guildId, canManageOthers, ownedCommanderIds: links.map((link) => link.ashedMemberId), refresh: async () => (await contextFor(payload)).actor } };
}

function button(token: string, action: string, label: string, style = 2): Button {
  return { type: 2, style, label: label.slice(0, 80), custom_id: timeOffCustomId(token, action) };
}

function rows(buttons: Button[]) {
  const result: Array<{ type: number; components: Button[] }> = [];
  for (let i = 0; i < buttons.length; i += 5) result.push({ type: 1, components: buttons.slice(i, i + 5) });
  return result;
}

function dateLabel(ctx: Context, date: string) {
  return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function summary(ctx: Context, entry: { memberName: string; startDate: string; endDate: string }) {
  return ctx.t("timeOff.entrySummary", { name: escapeTimeOffDiscordText(entry.memberName.slice(0, 120)), start: dateLabel(ctx, entry.startDate), end: dateLabel(ctx, entry.endDate) });
}

function assertMember(ctx: Context, memberId: string) {
  if (!ctx.actor.canManageOthers && !ctx.actor.ownedCommanderIds.includes(memberId)) throw new TimeOffError("forbidden", 403);
}

function assertOfficer(ctx: Context) {
  if (!ctx.actor.canManageOthers) throw new TimeOffError("officerOnly", 403);
}

async function loadEntry(ctx: Context, id: string) {
  const [row] = await getDb().select().from(schema.memberTimeOff)
    .where(and(eq(schema.memberTimeOff.allianceId, ctx.actor.allianceId), eq(schema.memberTimeOff.id, id))).limit(1);
  if (!row) throw new TimeOffError("entryUnavailable", 404);
  assertMember(ctx, row.ashedMemberId);
  return serializeTimeOffEntry(row);
}

function assertEditable(ctx: Context, entry: SerializedTimeOffEntry) {
  if (entry.cancelledAt || !canManageTimeOffEntry({ entryKind: entry.entryKind, canManageOthers: ctx.actor.canManageOthers, ownsCommander: ctx.actor.ownedCommanderIds.includes(entry.ashedMemberId) })) throw new TimeOffError("forbidden", 403);
}

async function showEntry(ctx: Context, id: string): Promise<TimeOffBotReply> {
  const entry = await loadEntry(ctx, id);
  const token = await saveTimeOffInteraction(ctx.actor, { kind: "entry", entryId: id, version: entry.version });
  let content = summary(ctx, entry);
  if (entry.notes) content += `\n${ctx.t("timeOff.privateNotesLine", { notes: escapeTimeOffDiscordText(entry.notes).slice(0, 1200) })}`;
  if (entry.cancelledAt) content += `\n${ctx.t("timeOff.workflow.cancelled")}`;
  if (entry.entryKind === "unexpected") content += `\n${ctx.t("timeOff.workflow.unexpectedHint")}`;
  const editable = !entry.cancelledAt && canManageTimeOffEntry({ entryKind: entry.entryKind, canManageOthers: ctx.actor.canManageOthers, ownsCommander: ctx.actor.ownedCommanderIds.includes(entry.ashedMemberId) });
  if (!editable && !entry.cancelledAt) content += `\n${ctx.t("timeOff.workflow.officerManaged")}`;
  return { content, components: rows([
    ...(editable ? [button(token, "edit", ctx.t("timeOff.workflow.edit")), button(token, "cancel", ctx.t("timeOff.entry.cancel"), 4)] : []),
    button(token, "back", ctx.t("timeOff.workflow.back")),
  ]) };
}

async function showList(ctx: Context, state: Extract<TimeOffDiscordState, { kind: "list" }>): Promise<TimeOffBotReply> {
  const page = Math.max(0, Math.min(state.page, 1000));
  let entries: SerializedTimeOffEntry[];
  let hasMore: boolean;
  let title: string;
  const today = getServerCalendarDate();
  if (state.memberId) {
    assertMember(ctx, state.memberId);
    const result = await listOwnTimeOffPage({ allianceId: ctx.actor.allianceId, ownedCommanderIds: [state.memberId], today, history: state.history, page, pageSize: 5 });
    entries = result.entries;
    hasMore = result.hasMore;
    title = ctx.t(state.history ? "timeOff.workflow.history" : "timeOff.workflow.upcoming");
  } else {
    assertOfficer(ctx);
    const start = state.rangeStart ?? today;
    const end = state.rangeEnd ?? today;
    if (!isTimeOffDate(start) || !isTimeOffDate(end)) throw new TimeOffError("invalidDate");
    const all = (await listActiveTimeOffEntries({ allianceId: ctx.actor.allianceId, rangeStart: start, rangeEnd: end })).filter((entry) => !state.unexpected || entry.entryKind === "unexpected");
    entries = all.slice(page * 5, page * 5 + 5);
    hasMore = all.length > (page + 1) * 5;
    title = state.unexpected
      ? ctx.t(entries.length ? "timeOff.unexpectedList" : "timeOff.unexpectedListEmpty", { date: dateLabel(ctx, start), entries: "" })
      : ctx.t(entries.length ? "timeOff.officerList" : "timeOff.officerListEmpty", { start: dateLabel(ctx, start), end: dateLabel(ctx, end), entries: "" });
  }
  const token = await saveTimeOffInteraction(ctx.actor, { ...state, page, entryIds: entries.map((entry) => entry.id) });
  const buttons = entries.map((entry, index) => button(token, `entry-${index}`, `${entry.memberName} · ${dateLabel(ctx, entry.startDate)}`));
  if (page > 0) buttons.push(button(token, "previous", ctx.t("timeOff.workflow.previous")));
  if (hasMore) buttons.push(button(token, "next", ctx.t("timeOff.workflow.next")));
  if (state.memberId) {
    const memberToken = await saveTimeOffInteraction(ctx.actor, { kind: "member", memberId: state.memberId, entryKind: ctx.actor.ownedCommanderIds.includes(state.memberId) ? "planned" : "officer_marked" });
    buttons.push(button(memberToken, "new", ctx.t("timeOff.form.title")));
    buttons.push(button(token, state.history ? "upcoming" : "history", ctx.t(state.history ? "timeOff.workflow.upcoming" : "timeOff.workflow.history")));
  }
  return { content: `${title}\n${entries.length ? entries.map((entry) => summary(ctx, entry)).join("\n") : state.memberId ? ctx.t(state.history ? "timeOff.workflow.noHistory" : "timeOff.workflow.noUpcoming") : ""}`.trim(), components: rows(buttons) };
}

async function showDraft(ctx: Context, draft: TimeOffDraft, existing?: { entryId: string; version: number }, requestId = ctx.requestId): Promise<TimeOffBotReply> {
  const validated = await previewTimeOff(ctx.actor, draft);
  const token = await saveTimeOffInteraction(ctx.actor, { kind: "draft", draft: validated, requestId, ...existing });
  const text = [ctx.t("timeOff.workflow.previewHint"), summary(ctx, validated), ctx.t("timeOff.workflow.serverTime"), ctx.t(draft.entryKind === "unexpected" ? "timeOff.workflow.unexpectedHint" : "timeOff.workflow.globalAbsence")];
  if (draft.notes) text.push(ctx.t("timeOff.privateNotesLine", { notes: escapeTimeOffDiscordText(draft.notes).slice(0, 1000) }));
  if (draft.entryKind !== "unexpected") {
    text.push(ctx.t("timeOff.workflow.noticeCutoff"));
    if (draft.startDate <= getServerCalendarDate()) text.push(ctx.t("timeOff.workflow.lateNotice", { date: dateLabel(ctx, draft.startDate) }));
  }
  return { content: text.join("\n"), components: rows([
    button(token, "confirm", ctx.t(existing ? "timeOff.workflow.saveChanges" : "timeOff.form.submit"), 1),
    button(token, "back", ctx.t("timeOff.workflow.back")),
  ]) };
}

async function forMember(ctx: Context, command: string, options: Record<string, string>, memberId: string): Promise<TimeOffBotReply> {
  if (command === "is-ally-offline") {
    const date = options.date || getServerCalendarDate();
    if (!isTimeOffDate(date)) throw new TimeOffError("invalidDate");
    const member = (await listTimeOffRoster(ctx.actor.allianceId)).find((row) => row.id === memberId);
    if (!member) throw new TimeOffError("commanderUnavailable");
    const entries = await listActiveTimeOffEntries({ allianceId: ctx.actor.allianceId, rangeStart: date, rangeEnd: date });
    const entry = entries.find((row) => row.ashedMemberId === memberId);
    return { content: entry
      ? ctx.t("timeOff.isAway", { name: escapeTimeOffDiscordText(member.name), date: dateLabel(ctx, date), summary: summary(ctx, entry) })
      : ctx.t("timeOff.isAvailable", { name: escapeTimeOffDiscordText(member.name), date: dateLabel(ctx, date) }) };
  }
  assertMember(ctx, memberId);
  if (command !== "my-time-off") assertOfficer(ctx);
  if (command === "cancel-time-off" || options.cancel) {
    if (options.cancel === "latest") {
      const entries = await listTimeOffForMember({ allianceId: ctx.actor.allianceId, ashedMemberId: memberId, onOrAfter: getServerCalendarDate() });
      const latest = entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
      if (latest) return showEntry(ctx, latest.id);
    }
    if (options.entry || options.cancel && options.cancel !== "latest") {
      const entry = await loadEntry(ctx, options.entry || options.cancel);
      if (entry.ashedMemberId !== memberId) throw new TimeOffError("forbidden", 403);
      return showEntry(ctx, entry.id);
    }
    return showList(ctx, { kind: "list", entryIds: [], memberId, page: 0, history: false });
  }
  let startDate = options.start;
  let endDate = options.end || startDate;
  let notes = options.notes || null;
  if (options.upcoming) {
    const parsed = parseTimeOffMessage(options.upcoming, getServerCalendarDate());
    if (!parsed.ok) throw new TimeOffError("parseFailed");
    startDate = parsed.parsed.startDate;
    endDate = parsed.parsed.endDate;
    notes ??= parsed.parsed.notes;
  }
  const entryKind = command === "set-time-off" ? options.kind === "unexpected" ? "unexpected" : "officer_marked" : "planned";
  if (startDate) return showDraft(ctx, { ashedMemberId: memberId, startDate, endDate, notes, entryKind });
  if (command === "set-time-off") {
    const token = await saveTimeOffInteraction(ctx.actor, { kind: "member", memberId, entryKind });
    return { content: ctx.t("timeOff.workflow.chooseEntry"), components: rows([button(token, "new", ctx.t("timeOff.form.title")), button(token, "list", ctx.t("timeOff.workflow.upcoming"))]) };
  }
  return showList(ctx, { kind: "list", entryIds: [], memberId, page: 0, history: false });
}

async function pickMember(ctx: Context, command: string, options: Record<string, string>, page = 0): Promise<TimeOffBotReply> {
  if (command === "set-time-off" || command === "cancel-time-off") assertOfficer(ctx);
  const roster = await listTimeOffRoster(ctx.actor.allianceId);
  let members = command === "my-time-off" ? roster.filter((member) => ctx.actor.ownedCommanderIds.includes(member.id)) : roster;
  if (command === "my-time-off" && !members.length) return { content: ctx.t("timeOff.notLinked") };
  const query = options.commander || options.member;
  if (query) {
    const exact = members.filter((member) => member.name.toLocaleLowerCase() === query.toLocaleLowerCase());
    if (exact.length === 1) return forMember(ctx, command, options, exact[0].id);
    members = members.map((member) => ({ ...member, score: nameMatchScore(query, member.name) })).filter((member) => member.score >= 0.45).sort((a, b) => b.score - a.score);
  } else if (members.length === 1) {
    return forMember(ctx, command, options, members[0].id);
  }
  if (!members.length) return { content: ctx.t("timeOff.workflow.noMatches") };
  const candidates = members.slice(page * 5, page * 5 + 5);
  const token = await saveTimeOffInteraction(ctx.actor, { kind: "members", memberIds: candidates.map((member) => member.id), command, options, page });
  const buttons = candidates.map((member, index) => button(token, `pick-${index}`, member.name));
  if (page > 0) buttons.push(button(token, "previous", ctx.t("timeOff.workflow.previous")));
  if (members.length > (page + 1) * 5) buttons.push(button(token, "next", ctx.t("timeOff.workflow.next")));
  return { content: ctx.t("timeOff.workflow.chooseCommander"), components: rows(buttons) };
}

async function handleComponent(ctx: Context, payload: DiscordInteractionPayload): Promise<TimeOffBotReply> {
  const parsed = parseTimeOffCustomId(payload.data?.custom_id);
  if (!parsed) throw new TimeOffError("expired");
  const state = await loadTimeOffInteraction(ctx.actor, parsed.token);
  const action = parsed.action;
  if (state.kind === "members") {
    if (action === "next" || action === "previous") return pickMember(ctx, state.command, state.options, Math.max(0, state.page + (action === "next" ? 1 : -1)));
    const index = /^pick-(\d)$/.exec(action);
    if (index && state.memberIds[Number(index[1])]) return forMember(ctx, state.command, state.options, state.memberIds[Number(index[1])]);
  }
  if (state.kind === "list") {
    const index = /^entry-(\d)$/.exec(action);
    if (index && state.entryIds[Number(index[1])]) return showEntry(ctx, state.entryIds[Number(index[1])]);
    if (["next", "previous", "history", "upcoming"].includes(action)) return showList(ctx, { ...state,
      page: action === "next" ? state.page + 1 : action === "previous" ? Math.max(0, state.page - 1) : 0,
      history: action === "history" || action !== "upcoming" && state.history,
    });
  }
  if (payload.type === 5 && action === "submit" && (state.kind === "member" || state.kind === "entry")) {
    const fields = Object.fromEntries((payload.data?.components ?? []).flatMap((row) => row.components ?? []).map((field) => [field.custom_id, field.value]));
    const existing = state.kind === "entry" ? await loadEntry(ctx, state.entryId) : null;
    if (existing) {
      assertEditable(ctx, existing);
      if (existing.version !== (state as Extract<TimeOffDiscordState, { kind: "entry" }>).version) throw new TimeOffError("staleEntry", 409);
    }
    const memberId = state.kind === "member" ? state.memberId : existing!.ashedMemberId;
    const entryKind = state.kind === "member" ? state.entryKind : existing!.entryKind;
    return showDraft(ctx, { ashedMemberId: memberId, startDate: fields.start ?? "", endDate: fields.end || fields.start || "", notes: fields.notes || null, entryKind }, existing ? { entryId: existing.id, version: existing.version } : undefined, state.requestId ?? ctx.requestId);
  }
  if (state.kind === "member" && action === "list") return showList(ctx, { kind: "list", entryIds: [], memberId: state.memberId, page: 0, history: false });
  if (state.kind === "entry") {
    const entry = await loadEntry(ctx, state.entryId);
    if (action === "back") return showList(ctx, { kind: "list", entryIds: [], memberId: entry.ashedMemberId, page: 0, history: false });
    if (action === "cancel") {
      assertEditable(ctx, entry);
      if (entry.version !== state.version) throw new TimeOffError("staleEntry", 409);
      const token = await saveTimeOffInteraction(ctx.actor, { kind: "cancel", entryId: entry.id, version: entry.version });
      return { content: `${ctx.t("timeOff.workflow.confirmCancel", { name: escapeTimeOffDiscordText(entry.memberName), start: dateLabel(ctx, entry.startDate), end: dateLabel(ctx, entry.endDate) })}\n${ctx.t("timeOff.workflow.cancelHint")}`, components: rows([
        button(token, "confirm", ctx.t("timeOff.entry.cancel"), 4), button(token, "back", ctx.t("timeOff.workflow.keepEntry")),
      ]) };
    }
  }
  if (state.kind === "cancel") {
    if (action === "back") return showEntry(ctx, state.entryId);
    if (action === "confirm") {
      await cancelTimeOff(ctx.actor, state.entryId, state.version);
      await dualWriteTimeOffToAshed({
        allianceId: ctx.actor.allianceId,
        entryId: state.entryId,
        discordUserId: ctx.actor.discordUserId,
        operation: "delete",
      });
      return { content: ctx.t("timeOff.workflow.cancelled") };
    }
  }
  if (state.kind === "draft") {
    if (action === "back") return state.entryId ? showEntry(ctx, state.entryId) : showList(ctx, { kind: "list", entryIds: [], memberId: state.draft.ashedMemberId, page: 0, history: false });
    if (action === "confirm") {
      const entry = state.entryId
        ? await updateTimeOff(ctx.actor, state.entryId, state.draft, state.version)
        : await createTimeOff(ctx.actor, state.draft, state.requestId);
      const ashedSyncFailed = await dualWriteTimeOffToAshed({
        allianceId: ctx.actor.allianceId,
        entryId: entry.id,
        discordUserId: ctx.actor.discordUserId,
        operation: "upsert",
      });
      return { content: `${ctx.t(state.entryId ? "timeOff.workflow.updated" : "timeOff.workflow.saved")}${ashedSyncFailed ? `\n${ctx.t("timeOff.errors.ashedSyncFailed")}` : ""}\n${summary(ctx, entry)}` };
    }
  }
  throw new TimeOffError("expired", 403);
}

export async function handleDiscordTimeOff(payload: DiscordInteractionPayload): Promise<TimeOffBotReply> {
  let locale = normalizeDiscordBotLocale(payload.locale);
  try {
    const ctx = await contextFor(payload);
    locale = ctx.locale;
    if (payload.type !== 2) return await handleComponent(ctx, payload);
    const command = payload.data?.name ?? "";
    const options = Object.fromEntries((payload.data?.options ?? []).filter((option) => typeof option.value === "string").map((option) => [option.name, String(option.value)]));
    if (command === "who-is-away" || command === "unexpected-absences") {
      assertOfficer(ctx);
      const date = options.date || getServerCalendarDate();
      if (!isTimeOffDate(date)) throw new TimeOffError("invalidDate");
      const start = options.range === "week" ? getWeekStartMonday(date) : date;
      return await showList(ctx, { kind: "list", entryIds: [], history: false, page: 0, rangeStart: start, rangeEnd: options.range === "week" ? addCalendarDays(start, 6) : date, unexpected: command === "unexpected-absences" });
    }
    if (command === "cancel-time-off" && options.entry) {
      assertOfficer(ctx);
      return await showEntry(ctx, options.entry);
    }
    return await pickMember(ctx, command, options);
  } catch (error) {
    const t = createDiscordTranslator(locale);
    const code = error instanceof TimeOffError ? error.code : "saveUnconfirmed";
    return { content: t(`timeOff.workflow.errors.${code}`, { maxDays: TIME_OFF_MAX_DAYS, maxLength: TIME_OFF_MAX_NOTES }) };
  }
}

export async function openDiscordTimeOffModal(payload: DiscordInteractionPayload) {
  try {
    const ctx = await contextFor(payload);
    const parsed = parseTimeOffCustomId(payload.data?.custom_id);
    if (!parsed) throw new TimeOffError("expired");
    const state = await loadTimeOffInteraction(ctx.actor, parsed.token);
    if (state.kind !== "member" && state.kind !== "entry") throw new TimeOffError("expired");
    const entry = state.kind === "entry" ? await loadEntry(ctx, state.entryId) : null;
    if (entry) {
      assertEditable(ctx, entry);
      if (state.kind !== "entry" || state.version !== entry.version) throw new TimeOffError("staleEntry", 409);
    } else if (state.kind === "member") {
      assertMember(ctx, state.memberId);
      if (state.entryKind !== "planned") assertOfficer(ctx);
    }
    const field = (id: string, label: string, value: string, long = false) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style: long ? 2 : 1, required: id === "start", max_length: long ? TIME_OFF_MAX_NOTES : 10, ...(value ? { value } : {}) }] });
    const formToken = await saveTimeOffInteraction(ctx.actor, { ...state, requestId: ctx.requestId });
    return { type: 9, data: { custom_id: timeOffCustomId(formToken, "submit"), title: ctx.t(entry ? "timeOff.workflow.edit" : "timeOff.form.title"), components: [
      field("start", ctx.t("timeOff.officerModal.start"), entry?.startDate ?? ""),
      field("end", ctx.t("timeOff.officerModal.end"), entry?.endDate ?? ""),
      field("notes", ctx.t("timeOff.workflow.privateNotes"), entry?.notes ?? "", true),
    ] } };
  } catch (error) {
    const t = createDiscordTranslator(normalizeDiscordBotLocale(payload.locale));
    return { type: 4, data: { flags: 64, allowed_mentions: { parse: [] }, content: t(`timeOff.workflow.errors.${error instanceof TimeOffError ? error.code : "loadFailed"}`) } };
  }
}
