import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { createDiscordTranslator, getDiscordBotLocale } from "@/lib/discord/i18n";
import { interactionDiscordUserId, interactionGuildId, type DiscordInteractionPayload } from "@/lib/discord/interactions";
import { escapeTimeOffDiscordText } from "@/lib/time-off/discord-workflow.shared";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { resolvePlanIdentity } from "./access.server";
import { loadPlunderPlan, lockPlans, mutatePlunderPlan, parsePlanCommand } from "./service.server";
import { expandPlan, isPlanDate, parsePlanSchedule, PlanScheduleError, type PlanSchedule } from "./schedule.shared";
import { PLAN_PALETTE } from "./colors.shared";
import { PlunderPlanError, type PlanActor, type PlanCommand, type PlanDashboard, type PlanSummary } from "./types.shared";

type BotActor = Extract<PlanActor, { kind: "discord" }>;
type Editor = { kind: "editor"; requestId: string; memberId?: string; planKind: "plan" | "suggestion"; planId?: string; version?: number; sourceId?: string; sourceVersion?: number; memberChoices?: string[]; schedule: PlanSchedule; reminder: boolean };
type State = { kind: "calendar"; date: string; week: boolean; page: number } | Editor | { kind: "list"; mode: string; page: number; planId?: string; version?: number; choices?: Array<{ id: string; version: number }>; dates?: Array<{ date: string; restore: boolean }> } | { kind: "entry"; id: string; version: number } | { kind: "color"; version: number; requestId: string } | { kind: "confirm"; command: PlanCommand; requestHash: string };
type Context = { actor: BotActor; locale: string; t: ReturnType<typeof createDiscordTranslator>; data: PlanDashboard; requestId: string };
export type PlanBotReply = { content: string; components?: unknown[] };
const PAGE = 5;
export function parsePlanComponent(value?: string) {
  const match = /^plunder:([\w-]{21}):([a-z0-9-]{1,24})$/.exec(value ?? "");
  return match ? { token: match[1], action: match[2] } : null;
}
export const plunderComponentNeedsModal = (value?: string) => ["weekly", "once", "custom"].includes(parsePlanComponent(value)?.action ?? "");

async function context(payload: DiscordInteractionPayload, days = 55): Promise<Context> {
  const discordUserId = interactionDiscordUserId(payload), guildId = interactionGuildId(payload);
  if (!discordUserId || !guildId || !payload.id || !/^\d{15,25}$/.test(payload.id)) throw new PlunderPlanError("forbidden", 403);
  const [guild] = await getDb().select({ allianceId: schema.discordGuildAlliances.allianceId }).from(schema.discordGuildAlliances).where(eq(schema.discordGuildAlliances.guildId, guildId));
  if (!guild) throw new PlunderPlanError("forbidden", 403);
  const actor: BotActor = { kind: "discord", guildId, discordUserId, allianceId: guild.allianceId };
  const locale = await getDiscordBotLocale(discordUserId, payload.locale);
  const today = getServerCalendarDate();
  return { actor, locale, t: createDiscordTranslator(locale), requestId: `discord-${payload.id}`, data: await loadPlunderPlan(actor, `${today}T02:00:00Z`, `${addCalendarDays(today, days)}T02:00:00Z`) };
}
function text(ctx: Context, key: string, params?: Record<string, string | number>) { return ctx.t(`plunderPlan.${key}`, params); }
function button(token: string, action: string, label: string, style = 2) { return { type: 2, style, custom_id: `plunder:${token}:${action}`, label: label.slice(0, 80) }; }
function rows(buttons: ReturnType<typeof button>[]) { return Array.from({ length: Math.ceil(buttons.length / 5) }, (_, i) => ({ type: 1, components: buttons.slice(i * 5, i * 5 + 5) })); }
function dateLabel(ctx: Context, date: string) { return new Intl.DateTimeFormat(ctx.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
function summary(ctx: Context, plan: Pick<PlanSummary, "memberName" | "schedule" | "kind">) {
  const schedule = plan.schedule;
  const days = schedule.days.map((day) => new Intl.DateTimeFormat(ctx.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join(", ");
  const time = (value: string) => new Intl.DateTimeFormat(ctx.locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2026-01-01T${value}:00Z`));
  return `${escapeTimeOffDiscordText(plan.memberName || text(ctx, "suggestionLabel"))}\n${text(ctx, schedule.kind === "weekly" ? "weeklySummary" : "onceSummary", { days, date: dateLabel(ctx, schedule.date), start: time(schedule.start), end: time(schedule.end), zone: schedule.zone })}${schedule.endsNextDay ? `\n${text(ctx, "endsNextDay")}` : ""}`;
}

async function saveState(actor: BotActor, state: State) {
  return getDb().transaction(async (tx) => {
    await lockPlans(tx, actor.allianceId); await resolvePlanIdentity(tx, actor);
    const active = await tx.select({ id: schema.plunderPlanInteractions.id }).from(schema.plunderPlanInteractions).where(and(eq(schema.plunderPlanInteractions.guildId, actor.guildId), eq(schema.plunderPlanInteractions.discordUserId, actor.discordUserId), gt(schema.plunderPlanInteractions.expiresAt, new Date()))).limit(201);
    if (active.length >= 200) throw new PlunderPlanError("rateLimit", 429);
    const id = nanoid();
    await tx.insert(schema.plunderPlanInteractions).values({ id, allianceId: actor.allianceId, guildId: actor.guildId, discordUserId: actor.discordUserId, state, expiresAt: new Date(Date.now() + 30 * 60_000) });
    return id;
  });
}
async function loadState(actor: BotActor, token: string): Promise<State> {
  const [row] = await getDb().select().from(schema.plunderPlanInteractions).where(and(eq(schema.plunderPlanInteractions.id, token), eq(schema.plunderPlanInteractions.allianceId, actor.allianceId), eq(schema.plunderPlanInteractions.guildId, actor.guildId), eq(schema.plunderPlanInteractions.discordUserId, actor.discordUserId), gt(schema.plunderPlanInteractions.expiresAt, new Date())));
  if (!row?.state || !["calendar", "editor", "list", "entry", "color", "confirm"].includes(String(row.state.kind))) throw new PlunderPlanError("expired", 409);
  return row.state as State;
}

export async function preparePlanConfirmation(actor: BotActor, input: unknown) {
  const command = parsePlanCommand(input);
  const requestHash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const token = await saveState(actor, { kind: "confirm", command, requestHash });
  return { command, token };
}
async function confirmation(ctx: Context, input: unknown): Promise<PlanBotReply> {
  const { command, token } = await preparePlanConfirmation(ctx.actor, input);
  let content = text(ctx, "confirm");
  if (command.action === "create" || command.action === "edit") {
    const name = command.action === "create" ? ctx.data.commanders.find((member) => member.id === command.memberId)?.name : ctx.data.plans.find((plan) => plan.id === command.id)?.memberName;
    content = `${summary(ctx, { memberName: name ?? "", kind: command.action === "create" ? command.kind : "plan", schedule: command.schedule })}\n${text(ctx, "visibility")}\n${text(ctx, "dstHint")}`;
    const preview = expandPlan(command.schedule, new Date().toISOString(), new Date(Date.now() + 14 * 86_400_000).toISOString()).occurrences.slice(0, 3);
    for (const occurrence of preview) content += `\n<t:${Math.floor(Date.parse(occurrence.startAt) / 1000)}:f>–<t:${Math.floor(Date.parse(occurrence.endAt) / 1000)}:t>`;
    if (command.reminder) content += `\n${text(ctx, "notifications.privateHint")}`;
  } else if (command.action === "color") content = `${text(ctx, "color.title")}: ${command.color}`;
  else if (command.action === "notifications") content = `${text(ctx, "notifications.digest")} · ${text(ctx, command.enabled ? "notifications.enableDigest" : "pausedLabel")}\n<#${command.channelId}> · ${command.timeSt} · ${command.locale}\n${text(ctx, "notifications.digestHint")}`;
  else content = `${text(ctx, command.action === "remove" ? "removeConfirm" : command.action === "restore" ? "restoreOccurrence" : command.action)}${"date" in command ? `\n${dateLabel(ctx, command.date)}` : ""}`;
  const buttons = [button(token, "confirm", text(ctx, "confirm"), 3)];
  if ((command.action === "create" && command.kind === "plan") || command.action === "edit") buttons.push(button(token, "reminder", text(ctx, "notifications.private"), command.reminder ? 3 : 2));
  return { content: content.slice(0, 2000), components: rows(buttons) };
}

async function editor(ctx: Context, state: Editor): Promise<PlanBotReply> {
  const token = await saveState(ctx.actor, { ...state, memberChoices: ctx.data.commanders.slice(0, 5).map((member) => member.id) });
  if (state.planKind === "plan" && !state.memberId) return { content: text(ctx, "chooseCommander"), components: rows(ctx.data.commanders.slice(0, 5).map((member, i) => button(token, `member-${i}`, member.name))) };
  return { content: `${text(ctx, "scheduleType")}\n${text(ctx, "chooseZone")}`, components: rows([button(token, "weekly", text(ctx, "weekly")), button(token, "once", text(ctx, "once"))]) };
}
function blankEditor(ctx: Context, suggestion = false): Editor { return { kind: "editor", requestId: ctx.requestId, planKind: suggestion ? "suggestion" : "plan", reminder: false, schedule: { kind: "weekly", date: getServerCalendarDate(), days: [new Date(`${getServerCalendarDate()}T12:00:00Z`).getUTCDay()], start: "20:00", end: "21:00", zone: "Etc/GMT+2", endsNextDay: false } }; }

async function calendar(ctx: Context, state: Extract<State, { kind: "calendar" }>): Promise<PlanBotReply> {
  if (!isPlanDate(state.date)) throw new PlunderPlanError("invalidSchedule");
  const end = addCalendarDays(state.date, state.week ? 7 : 1);
  const data = await loadPlunderPlan(ctx.actor, `${state.date}T02:00:00Z`, `${end}T02:00:00Z`);
  const entries = data.occurrences.filter((row) => row.kind === "plan").sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  const page = Math.max(0, Math.min(state.page, Math.max(0, Math.ceil(entries.length / PAGE) - 1)));
  const token = await saveState(ctx.actor, { ...state, page });
  const lines = entries.slice(page * PAGE, (page + 1) * PAGE).map((row) => `${escapeTimeOffDiscordText(row.memberName.slice(0, 80))}: <t:${Math.floor(Date.parse(row.startAt) / 1000)}:f>–<t:${Math.floor(Date.parse(row.endAt) / 1000)}:t>`);
  return { content: `${text(ctx, "calendar")} · ${dateLabel(ctx, state.date)} · ${text(ctx, "serverTime")}\n${lines.length ? lines.join("\n") : text(ctx, "empty")}`, components: rows([...(page ? [button(token, "previous", text(ctx, "previousPage"))] : []), ...(entries.length > (page + 1) * PAGE ? [button(token, "next", text(ctx, "nextPage"))] : [])]) };
}

async function list(ctx: Context, state: Extract<State, { kind: "list" }>): Promise<PlanBotReply> {
  const page = Math.max(0, Math.min(state.page, 100));
  const all = state.mode === "join" || state.mode === "suggestions" ? ctx.data.plans.filter((plan) => plan.kind === "suggestion") : ctx.data.plans.filter((plan) => plan.owned && plan.kind === "plan");
  const selected = all.slice(page * PAGE, (page + 1) * PAGE);
  const token = await saveState(ctx.actor, { ...state, page, choices: selected.map((plan) => ({ id: plan.id, version: plan.version })) });
  const buttons = selected.map((plan, i) => button(token, `pick-${i}`, `${plan.memberName || text(ctx, "suggestionLabel")} · ${plan.schedule.start}`));
  if (page) buttons.push(button(token, "previous", text(ctx, "previousPage")));
  if (all.length > (page + 1) * PAGE) buttons.push(button(token, "next", text(ctx, "nextPage")));
  if (state.mode === "suggestions" && ctx.data.canSuggest) buttons.push(button(token, "suggest", text(ctx, "suggest"), 1));
  return { content: selected.length ? selected.map((plan) => summary(ctx, plan)).join("\n\n").slice(0, 1900) : text(ctx, state.mode === "join" || state.mode === "suggestions" ? "emptySuggestions" : "emptyOwn"), components: rows(buttons) };
}
async function entry(ctx: Context, plan: PlanSummary): Promise<PlanBotReply> {
  const token = await saveState(ctx.actor, { kind: "entry", id: plan.id, version: plan.version });
  const buttons = [button(token, "edit", text(ctx, plan.kind === "suggestion" ? "editSuggestion" : "edit")), button(token, "remove", text(ctx, plan.kind === "suggestion" ? "removeSuggestion" : "remove"))];
  if (plan.schedule.kind === "weekly") buttons.push(button(token, plan.active ? "pause" : "resume", text(ctx, plan.active ? "pause" : "resume")), button(token, "skip", text(ctx, "skip")));
  return { content: summary(ctx, plan), components: rows(buttons) };
}
async function dates(ctx: Context, plan: PlanSummary, page = 0): Promise<PlanBotReply> {
  const all = expandPlan(plan.schedule, new Date().toISOString(), new Date(Date.now() + 55 * 86_400_000).toISOString()).occurrences;
  const token = await saveState(ctx.actor, { kind: "list", mode: "dates", planId: plan.id, version: plan.version, page, dates: all.slice(page * PAGE, (page + 1) * PAGE).map((row) => ({ date: row.localDate, restore: ctx.data.suppressed.some((item) => item.planId === plan.id && item.date === row.localDate && item.reason === "skippedLabel") })) });
  const buttons = all.slice(page * PAGE, (page + 1) * PAGE).map((row, i) => button(token, `date-${i}`, `${dateLabel(ctx, row.localDate)}${ctx.data.suppressed.some((item) => item.planId === plan.id && item.date === row.localDate && item.reason === "skippedLabel") ? ` · ${text(ctx, "restoreOccurrence")}` : ""}`));
  if (page) buttons.push(button(token, "previous", text(ctx, "previousPage")));
  if (all.length > (page + 1) * PAGE) buttons.push(button(token, "next", text(ctx, "nextPage")));
  return { content: `${summary(ctx, plan)}\n${text(ctx, "skip")}`, components: rows(buttons) };
}

export async function openPlunderPlanModal(payload: DiscordInteractionPayload) {
  try {
    const ctx = await context(payload, 1), parsed = parsePlanComponent(payload.data?.custom_id);
    if (!parsed) throw new PlunderPlanError("expired");
    const state = await loadState(ctx.actor, parsed.token);
    let fields: Array<{ id: string; label: string; value: string }>;
    let token = parsed.token;
    if (state.kind === "color" && parsed.action === "custom") fields = [{ id: "color", label: text(ctx, "color.hex"), value: ctx.data.color }];
    else if (state.kind === "editor" && (parsed.action === "weekly" || parsed.action === "once")) {
      if (state.planKind === "suggestion" ? !ctx.data.canSuggest : !ctx.data.commanders.some((member) => member.id === state.memberId)) throw new PlunderPlanError("forbidden", 403);
      const schedule: PlanSchedule = { ...state.schedule, kind: parsed.action };
      token = await saveState(ctx.actor, { ...state, schedule });
      const names = schedule.days.map((day) => new Intl.DateTimeFormat(ctx.locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join(", ");
      fields = [{ id: "date", label: text(ctx, schedule.kind === "once" ? "date" : "startsOn"), value: schedule.date }, { id: "start", label: text(ctx, "startTime"), value: schedule.start }, { id: "end", label: text(ctx, "endTime"), value: schedule.end }, { id: "zone", label: text(ctx, "timeZone"), value: schedule.zone }, ...(schedule.kind === "weekly" ? [{ id: "days", label: text(ctx, "weekdays"), value: names }] : [])];
    } else throw new PlunderPlanError("expired");
    return { type: 9, data: { custom_id: `plunder:${token}:submit`, title: text(ctx, state.kind === "color" ? "color.title" : "title"), components: fields.map((field) => ({ type: 1, components: [{ type: 4, style: 1, custom_id: field.id, label: field.label, value: field.value, required: true, max_length: 100 }] })) } };
  } catch (error) { const reply = await errorReply(payload, error); return { type: 4, data: { ...reply, flags: 64, allowed_mentions: { parse: [] } } }; }
}

function parseDays(value: string, locale: string): number[] {
  const normalize = (text: string) => text.toLocaleLowerCase(locale).replace(/[.]/g, "").trim();
  return value.split(/[,;]/).map((part) => {
    for (let day = 0; day < 7; day++) for (const length of ["short", "long"] as const) if (normalize(part) === normalize(new Intl.DateTimeFormat(locale, { weekday: length, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day))))) return day;
    throw new PlunderPlanError("invalidSchedule");
  });
}

async function errorReply(payload: DiscordInteractionPayload, error: unknown): Promise<PlanBotReply> {
  const locale = await getDiscordBotLocale(interactionDiscordUserId(payload) ?? "", payload.locale);
  const code = error instanceof PlunderPlanError || error instanceof PlanScheduleError ? error.code : "save";
  return { content: createDiscordTranslator(locale)(`plunderPlan.errors.${code}`) };
}

export async function handlePlunderPlanDiscord(payload: DiscordInteractionPayload): Promise<PlanBotReply> {
  try {
    const ctx = await context(payload);
    if (payload.type === 2) {
      const option = payload.data?.options?.[0] as { name?: string; options?: Array<{ name: string; value?: unknown }> } | undefined;
      const mode = option?.name ?? "schedule";
      const options = Object.fromEntries((option?.options ?? []).map((row) => [row.name, row.value]));
      if (mode === "plan") return editor(ctx, blankEditor(ctx));
      if (mode === "schedule") {
        const date = typeof options.date === "string" ? options.date : getServerCalendarDate();
        if (!isPlanDate(date)) throw new PlunderPlanError("invalidSchedule");
        return calendar(ctx, { kind: "calendar", date, week: options.view === "week", page: 0 });
      }
      if (mode === "color") {
        const token = await saveState(ctx.actor, { kind: "color", version: ctx.data.colorVersion, requestId: ctx.requestId });
        return { content: text(ctx, "chooseColor"), components: rows([...Object.keys(PLAN_PALETTE).map((name) => button(token, `color-${name}`, text(ctx, `color.${name}`))), button(token, "custom", text(ctx, "color.custom"))]) };
      }
      if (mode === "notifications" && typeof options.enabled === "boolean") {
        const setting = ctx.data.notificationSettings.find((setting) => setting.guildId === ctx.actor.guildId);
        if (!setting) throw new PlunderPlanError("forbidden", 403);
        return confirmation(ctx, { action: "notifications", requestId: ctx.requestId, guildId: ctx.actor.guildId, channelId: options.channel ?? (setting.channelId || payload.channel_id), timeSt: options.time ?? setting.timeSt, locale: options.language ?? ctx.locale, enabled: options.enabled, expectedVersion: setting.version });
      }
      if (mode === "suggestions" && !ctx.data.canSuggest) throw new PlunderPlanError("forbidden", 403);
      return list(ctx, { kind: "list", mode: mode === "notifications" ? "edit" : mode, page: 0 });
    }
    const parsed = parsePlanComponent(payload.data?.custom_id);
    if (!parsed) throw new PlunderPlanError("expired");
    const state = await loadState(ctx.actor, parsed.token), action = parsed.action;
    if (state.kind === "calendar") {
      if (action !== "next" && action !== "previous") throw new PlunderPlanError("expired");
      return calendar(ctx, { ...state, page: state.page + (action === "next" ? 1 : -1) });
    }
    if (state.kind === "confirm") {
      if (action === "reminder" && (state.command.action === "create" || state.command.action === "edit")) return confirmation(ctx, { ...state.command, reminder: !state.command.reminder });
      if (action !== "confirm") throw new PlunderPlanError("expired");
      await mutatePlunderPlan(ctx.actor, state.command, parsed.token);
      const key = { create: "saved", edit: "saved", color: "color.saved", notifications: "notifications.saved", skip: "skipped", restore: "restored", pause: "paused", resume: "resumed", remove: "removed" }[state.command.action];
      return { content: text(ctx, key) };
    }
    if (state.kind === "color") {
      const value = payload.type === 5 ? payload.data?.components?.flatMap((row) => row.components ?? []).find((row) => row.custom_id === "color")?.value : action.replace(/^color-/, "");
      return confirmation(ctx, { action: "color", requestId: state.requestId, expectedVersion: state.version, color: value });
    }
    if (state.kind === "editor") {
      if (action.startsWith("member-")) {
        const member = ctx.data.commanders.find((member) => member.id === state.memberChoices?.[Number(action.slice(7))]);
        if (!member) throw new PlunderPlanError("linkRequired");
        return editor(ctx, { ...state, memberId: member.id });
      }
      if (payload.type !== 5 || action !== "submit") throw new PlunderPlanError("expired");
      const values = Object.fromEntries((payload.data?.components ?? []).flatMap((row) => row.components ?? []).map((row) => [row.custom_id, row.value ?? ""]));
      const schedule = parsePlanSchedule({ kind: state.schedule.kind, date: values.date, zone: values.zone, start: values.start, end: values.end, endsNextDay: values.end <= values.start, days: state.schedule.kind === "weekly" ? parseDays(values.days ?? "", ctx.locale) : [] });
      return confirmation(ctx, state.planId ? { action: "edit", id: state.planId, expectedVersion: state.version, requestId: state.requestId, schedule, reminder: state.reminder } : { action: "create", kind: state.planKind, memberId: state.memberId, sourceId: state.sourceId, sourceVersion: state.sourceVersion, requestId: state.requestId, schedule, reminder: state.reminder });
    }
    if (state.kind === "list") {
      if (action === "suggest" && ctx.data.canSuggest) return editor(ctx, blankEditor(ctx, true));
      if (state.mode === "dates") {
        const plan = ctx.data.plans.find((plan) => plan.id === state.planId && plan.owned);
        if (!plan) throw new PlunderPlanError("notFound");
        if (action === "next" || action === "previous") return dates(ctx, plan, Math.max(0, Math.min(100, state.page + (action === "next" ? 1 : -1))));
        const occurrence = state.dates?.[Number(action.replace("date-", ""))];
        if (!occurrence || state.version !== plan.version) throw new PlunderPlanError("stale", 409);
        return confirmation(ctx, { action: occurrence.restore ? "restore" : "skip", requestId: ctx.requestId, id: plan.id, expectedVersion: state.version, date: occurrence.date });
      }
      if (action === "next" || action === "previous") return list(ctx, { ...state, page: state.page + (action === "next" ? 1 : -1) });
      const plans = state.mode === "join" || state.mode === "suggestions" ? ctx.data.plans.filter((plan) => plan.kind === "suggestion") : ctx.data.plans.filter((plan) => plan.owned && plan.kind === "plan");
      const choice = state.choices?.[Number(action.replace("pick-", ""))];
      const plan = plans.find((plan) => plan.id === choice?.id);
      if (!plan || plan.version !== choice?.version) throw new PlunderPlanError("stale", 409);
      if (state.mode === "join") return editor(ctx, { ...blankEditor(ctx), sourceId: plan.id, sourceVersion: plan.version, schedule: plan.schedule });
      if (state.mode === "edit") return editor(ctx, { kind: "editor", requestId: ctx.requestId, planKind: plan.kind, memberId: plan.memberId ?? undefined, planId: plan.id, version: plan.version, schedule: plan.schedule, reminder: plan.reminder });
      if (state.mode === "skip") return dates(ctx, plan);
      if (["pause", "resume", "remove"].includes(state.mode)) return confirmation(ctx, { action: state.mode, id: plan.id, expectedVersion: plan.version, requestId: ctx.requestId });
      return entry(ctx, plan);
    }
    const plan = ctx.data.plans.find((plan) => plan.id === state.id);
    if (!plan || plan.version !== state.version) throw new PlunderPlanError("stale", 409);
    if (action === "edit") return editor(ctx, { kind: "editor", requestId: ctx.requestId, planKind: plan.kind, planId: plan.id, version: plan.version, memberId: plan.memberId ?? undefined, schedule: plan.schedule, reminder: plan.reminder });
    if (action === "skip") return dates(ctx, plan);
    return confirmation(ctx, { action, id: plan.id, expectedVersion: plan.version, requestId: ctx.requestId });
  } catch (error) { return errorReply(payload, error); }
}
