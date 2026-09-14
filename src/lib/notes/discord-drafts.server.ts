import "server-only";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { buildDiscordBotAppUrl } from "@/lib/discord/app-url.shared";
import { createDiscordTranslator, type DiscordBotLocale } from "@/lib/discord/i18n";
import { parseModalTextInput, parseSlashOptionString, type DiscordInteractionPayload } from "@/lib/discord/interactions";
import { attachAskMessage, officerGuard, type PerfDiscordComponents, type PerfInteractionResult } from "@/lib/performance-notes/discord-handlers.server";
import { listPerformanceNoteRoster } from "@/lib/performance-notes/repository.server";
import { saveDiscordBotPending } from "@/lib/vr/repository";
import { commitCaptureDraft, getCaptureDraft, saveCaptureDraft } from "./drafts.server";
import { applyDraftInterpretation, automaticActionModes, draftStateSchema, editDraftAction, reviewedDraftTasks, type CaptureDraft, type CaptureDraftState } from "./drafts.shared";
import { interpretNoteCapture, loadIntakePreference, saveIntakePreference } from "./intake.server";
import { detectNoteMentions, resolveExactNoteMembers } from "./mentions.shared";
import { knowledgeHash } from "./mutations.server";
import type { KnowledgeActor } from "./policy.shared";
import { KnowledgeAccessError } from "./resources.server";
import { TASK_STATUSES } from "./tasks.shared";
import { NOTE_PRIORITIES } from "./workspace.shared";

const prefix = "note:draft:";
export function parseDiscordDraftControl(value: string | undefined) {
  const match = value?.match(/^note:draft:([\w-]{8,120}):(\d+):(save|only|body|members|task|status|priority|title|include|back|ai|attention|reset)(?::(\d+))?$/);
  return match ? { id: match[1], version: Number(match[2]), action: match[3], index: match[4] === undefined ? undefined : Number(match[4]) } : null;
}
export const discordDraftNeedsModal = (id?: string) => ["body", "members", "title"].includes(parseDiscordDraftControl(id)?.action ?? "");
type Translator = ReturnType<typeof createDiscordTranslator>;
const key = (draft: CaptureDraft, action: string, index?: number) => `${prefix}${draft.id}:${draft.version}:${action}${index === undefined ? "" : `:${index}`}`;
const button = (draft: CaptureDraft, action: string, label: string, index?: number) => ({ type: 2, style: 2, label: label.slice(0, 80), custom_id: key(draft, action, index) });

async function detectedMembers(actor: KnowledgeActor, body: string) {
  const roster = await listPerformanceNoteRoster(actor.allianceId);
  const detection = detectNoteMentions(body, roster);
  const ids = new Set(detection.memberIds);
  let ambiguous = detection.matches.some((match) => match.candidates.length > 1);
  const mentions = [...body.matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]);
  if (mentions.length) {
    const links = await getDb().select({ discordId: schema.discordMemberLinks.discordUserId, memberId: schema.discordMemberLinks.ashedMemberId }).from(schema.discordMemberLinks).where(eq(schema.discordMemberLinks.allianceId, actor.allianceId));
    for (const mention of mentions) {
      const candidates = [...new Set(links.filter((link) => link.discordId === mention && roster.some((member) => member.ashedMemberId === link.memberId)).map((link) => link.memberId))];
      if (candidates.length === 1) ids.add(candidates[0]); else if (candidates.length > 1) ambiguous = true;
    }
  }
  return { roster, memberIds: [...ids], ambiguous };
}
async function analyze(actor: KnowledgeActor, draft: CaptureDraft, locale: DiscordBotLocale): Promise<CaptureDraft> {
  if (!draft.state?.aiEnabled || draft.status !== "open") return draft;
  const preference = await loadIntakePreference(actor);
  if (!preference.enabled || !preference.configured) return draft;
  try {
    const output = await interpretNoteCapture(actor, { draftId: draft.id, revision: draft.state.revision, overrideRevision: draft.state.overrideRevision, body: draft.state.fields.body.trim(), locale, ...(draft.sourceNoteId ? { noteId: draft.sourceNoteId, expectedVersion: draft.sourceVersion ?? undefined } : {}) });
    if (output.state !== "complete") return draft;
    const current = await officerGuard({ allianceId: actor.allianceId, discordUserId: actor.discordUserId!, locale });
    if (!current.ok || current.actor.hqUserId !== actor.hqUserId) throw new KnowledgeAccessError("forbidden");
    return await saveCaptureDraft(actor, draft.id, { expectedVersion: draft.version, sourceNoteId: draft.sourceNoteId, sourceVersion: draft.sourceVersion, state: applyDraftInterpretation(draft.state, output.result) });
  } catch (error) {
    if (error instanceof KnowledgeAccessError && error.code === "changed") return getCaptureDraft(actor, draft.id);
    return draft;
  }
}
async function review(actor: KnowledgeActor, draft: CaptureDraft, locale: DiscordBotLocale, warning?: string): Promise<PerfInteractionResult> {
  const t = createDiscordTranslator(locale);
  const current = await officerGuard({ allianceId: actor.allianceId, discordUserId: actor.discordUserId!, locale });
  if (!current.ok) return current.result;
  if (current.actor.hqUserId !== actor.hqUserId) return { type: "message", content: t("performanceNotes.review.unavailable") };
  draft = await getCaptureDraft(current.actor, draft.id);
  if (draft.status === "committed" || !draft.state) return { type: "message", content: t("performanceNotes.doneView", { url: buildDiscordBotAppUrl(locale, `/notes/${draft.noteId}`) }) };
  const state = draft.state;
  const detection = await detectedMembers(actor, state.fields.body);
  const preference = await loadIntakePreference(actor);
  const people = detection.roster.filter((member) => state.fields.memberIds.includes(member.ashedMemberId)).map((member) => member.name).join(", ").slice(0, 300);
  const tasks = state.tasks.map((task, index) => `${index + 1}. ${task.included ? "[x]" : "[ ]"} ${task.title.slice(0, 65)} · ${t(`performanceNotes.review.status.${task.status}`)} · ${t(`performanceNotes.review.priority.${task.priority ?? "none"}`)}`).join("\n");
  const components: PerfDiscordComponents = [{ type: 1, components: [button(draft, "save", t("performanceNotes.review.save")), button(draft, "only", t("performanceNotes.review.only")), button(draft, "body", t("performanceNotes.review.editBody")), button(draft, "members", t("performanceNotes.review.editMembers")), button(draft, "ai", t(preference.enabled ? state.aiEnabled ? "performanceNotes.review.pause" : "performanceNotes.review.resume" : "performanceNotes.review.enable"))] }];
  components.push({ type: 1, components: [{ type: 3, custom_id: key(draft, "attention"), placeholder: t("performanceNotes.review.notePriority"), options: [{ label: t("performanceNotes.review.reset"), value: "auto", default: false }, ...["none", ...NOTE_PRIORITIES].map((priority) => ({ label: t(`performanceNotes.review.priority.${priority}`), value: priority, default: (state.fields.priority ?? "none") === priority }))] }] });
  if (state.tasks.length) components.push({ type: 1, components: [{ type: 3, custom_id: key(draft, "task"), placeholder: t("performanceNotes.review.chooseTask"), options: state.tasks.map((task, index) => ({ label: task.title.slice(0, 100), value: String(index) })) }] });
  return { type: "message", content: [warning, t("performanceNotes.review.intro"), t("performanceNotes.review.members", { names: people || t("performanceNotes.review.none") }), t("performanceNotes.review.attention", { priority: t(`performanceNotes.review.priority.${state.fields.priority ?? "none"}`) }), detection.ambiguous ? t("performanceNotes.review.ambiguous") : "", tasks, t("performanceNotes.review.web", { url: buildDiscordBotAppUrl(locale, `/notes?view=drafts&draft=${draft.id}`) }), !actor.hqUserId ? t("performanceNotes.hqLinkHint") : ""].filter(Boolean).join("\n\n"), components };
}
function taskReview(draft: CaptureDraft, index: number, t: Translator): PerfInteractionResult {
  const task = draft.state?.tasks[index];
  if (!task) throw new KnowledgeAccessError("invalid");
  return { type: "message", content: [task.title, task.evidence ?? "", t("performanceNotes.review.taskHint")].filter(Boolean).join("\n\n"), components: [
    { type: 1, components: [{ type: 3, custom_id: key(draft, "status", index), placeholder: t("performanceNotes.review.statusLabel"), options: ["none", ...TASK_STATUSES].map((status) => ({ label: t(`performanceNotes.review.status.${status}`), value: status, default: task.included ? task.status === status : status === "none" })) }] },
    { type: 1, components: [{ type: 3, custom_id: key(draft, "priority", index), placeholder: t("performanceNotes.review.priorityLabel"), options: ["none", ...NOTE_PRIORITIES].map((priority) => ({ label: t(`performanceNotes.review.priority.${priority}`), value: priority, default: (task.priority ?? "none") === priority })) }] },
    { type: 1, components: [button(draft, "title", t("performanceNotes.review.editTitle"), index), button(draft, "include", t(task.included ? "performanceNotes.review.exclude" : "performanceNotes.review.include"), index), button(draft, "reset", t("performanceNotes.review.reset"), index), button(draft, "back", t("performanceNotes.review.back"))] },
  ] };
}

export async function handleDiscordDraft(input: { payload: DiscordInteractionPayload; allianceId: string | null; discordUserId: string; locale: DiscordBotLocale }): Promise<PerfInteractionResult> {
  const t = createDiscordTranslator(input.locale);
  const gated = await officerGuard(input);
  if (!gated.ok) return gated.result;
  const actor = gated.actor;
  const control = parseDiscordDraftControl(input.payload.data?.custom_id);
  let draft: CaptureDraft | undefined;
  try {
    if (input.payload.type === 2) {
      const body = parseSlashOptionString(input.payload, "text")?.trim();
      if (!body) return { type: "message", content: t("performanceNotes.emptyText") };
      if (body.length > 4_000 || !input.payload.id) throw new KnowledgeAccessError("invalid");
      const id = knowledgeHash(["discord-draft", actor.allianceId, actor.discordUserId, input.payload.id]).slice(0, 40);
      try { draft = await getCaptureDraft(actor, id); } catch (error) { if (!(error instanceof KnowledgeAccessError) || error.code !== "not_found") throw error; }
      if (!draft) {
        const members = await detectedMembers(actor, body);
        const state = draftStateSchema.parse({ fields: { body, priorityMode: "auto", memberIds: members.memberIds, detectedMemberIds: members.memberIds } });
        draft = await saveCaptureDraft(actor, id, { expectedVersion: 0, state, sourceNoteId: null, sourceVersion: null });
      }
      return review(actor, await analyze(actor, draft, input.locale), input.locale);
    }
    if (!control) throw new KnowledgeAccessError("invalid");
    draft = await getCaptureDraft(actor, control.id);
    if (!draft.state || draft.status === "committed") return review(actor, draft, input.locale);
    if (draft.version !== control.version) return review(actor, draft, input.locale, t("performanceNotes.review.changed"));
    let state: CaptureDraftState = draft.state;
    const index = control.index ?? Number(input.payload.data?.values?.[0]);
    const value = input.payload.data?.values?.[0];
    if (input.payload.type === 3 && discordDraftNeedsModal(input.payload.data?.custom_id)) {
      const text = control.action === "body" ? state.fields.body : control.action === "title" ? state.tasks[index]?.title : (await listPerformanceNoteRoster(actor.allianceId)).filter((member) => state.fields.memberIds.includes(member.ashedMemberId)).map((member) => member.name).join("\n");
      if (text === undefined || text.length > 4_000) throw new KnowledgeAccessError("invalid");
      const label = t(control.action === "body" ? "performanceNotes.review.editBody" : control.action === "title" ? "performanceNotes.review.editTitle" : "performanceNotes.review.editMembers");
      return { type: "modal", customId: key(draft, control.action, control.index), title: label, fieldCustomId: "value", fieldLabel: label, value: text, required: control.action !== "members", paragraph: control.action !== "title", maxLength: control.action === "title" ? 160 : 4_000 };
    }
    if (control.action === "save" || control.action === "only") {
      if (control.action === "only") {
        state = { ...state, tasks: state.tasks.map((task) => ({ ...task, included: false })) };
        draft = await saveCaptureDraft(actor, draft.id, { expectedVersion: draft.version, state, sourceNoteId: draft.sourceNoteId, sourceVersion: draft.sourceVersion });
      }
      const result = await commitCaptureDraft(actor, draft.id, draft.version, `discord-save:${draft.id}`);
      if (!state.fields.memberIds.length) {
        await saveDiscordBotPending(actor.allianceId, input.discordUserId, { kind: "perf_note_attach", noteId: result.noteId! });
        return attachAskMessage(t, input.locale, result.noteId!, !actor.hqUserId);
      }
      return { type: "message", content: t("performanceNotes.review.saved", { count: reviewedDraftTasks(state).length, url: buildDiscordBotAppUrl(input.locale, `/notes/${result.noteId}`) }) };
    }
    if (control.action === "task") return taskReview(draft, index, t);
    if (control.action === "back") return review(actor, draft, input.locale);
    if (control.action === "attention" && value === "auto") {
      state = { ...state, overrideRevision: state.overrideRevision + 1, fields: { ...state.fields, priorityMode: "auto" } };
    } else if (control.action === "attention" && (value === "none" || NOTE_PRIORITIES.includes(value as typeof NOTE_PRIORITIES[number]))) {
      state = { ...state, overrideRevision: state.overrideRevision + 1, fields: { ...state.fields, priorityMode: "manual", priority: value === "none" ? null : value as typeof NOTE_PRIORITIES[number] } };
    } else if (control.action === "ai") {
      const preference = await loadIntakePreference(actor);
      if (!preference.enabled) await saveIntakePreference(actor, true, preference.version);
      state = { ...state, aiEnabled: preference.enabled ? !state.aiEnabled : true, overrideRevision: state.overrideRevision + 1 };
    } else if (input.payload.type === 5) {
      const text = parseModalTextInput(input.payload, "value")?.trim() ?? "";
      if (control.action === "body") {
        if (!text) throw new KnowledgeAccessError("invalid");
        const detected = await detectedMembers(actor, text);
        const manual = state.fields.memberIds.filter((id) => !state.fields.detectedMemberIds.includes(id));
        const ids = detected.memberIds.filter((id) => !state.fields.excludedMemberIds.includes(id));
        state = { ...state, revision: state.revision + 1, fields: { ...state.fields, body: text, memberIds: [...new Set([...manual, ...ids])], detectedMemberIds: ids, priority: state.fields.priorityMode === "auto" ? null : state.fields.priority } };
      } else if (control.action === "members") {
        const ids = resolveExactNoteMembers(text.split(/\n/).map((name) => name.trim()).filter(Boolean), await listPerformanceNoteRoster(actor.allianceId));
        if (!ids || ids.length > 50) throw new KnowledgeAccessError("invalid");
        state = { ...state, overrideRevision: state.overrideRevision + 1, fields: { ...state.fields, memberIds: ids, detectedMemberIds: [], excludedMemberIds: [...new Set([...state.fields.excludedMemberIds, ...state.fields.memberIds.filter((id) => !ids.includes(id))])].filter((id) => !ids.includes(id)) } };
      } else if (control.action === "title" && state.tasks[index] && text) state = editDraftAction(state, state.tasks[index].actionKey, { title: text });
      else throw new KnowledgeAccessError("invalid");
    } else if (state.tasks[index]) {
      const task = state.tasks[index];
      if (control.action === "status" && value === "none") state = editDraftAction(state, task.actionKey, { included: false });
      else if (control.action === "status" && TASK_STATUSES.includes(value as typeof TASK_STATUSES[number])) state = editDraftAction(state, task.actionKey, { status: value as typeof TASK_STATUSES[number], included: true });
      else if (control.action === "priority" && (value === "none" || NOTE_PRIORITIES.includes(value as typeof NOTE_PRIORITIES[number]))) state = editDraftAction(state, task.actionKey, { priority: value === "none" ? null : value as typeof NOTE_PRIORITIES[number] });
      else if (control.action === "include") state = editDraftAction(state, task.actionKey, { included: !task.included });
      else if (control.action === "reset") state = { ...state, overrideRevision: state.overrideRevision + 1, tasks: state.tasks.map((item) => item.actionKey === task.actionKey ? { ...item, modes: automaticActionModes() } : item) };
      else throw new KnowledgeAccessError("invalid");
    } else throw new KnowledgeAccessError("invalid");
    draft = await saveCaptureDraft(actor, draft.id, { expectedVersion: draft.version, state, sourceNoteId: draft.sourceNoteId, sourceVersion: draft.sourceVersion });
    if (["ai", "body", "reset"].includes(control.action) || control.action === "attention" && value === "auto") draft = await analyze(actor, draft, input.locale);
    return ["status", "priority", "title", "include"].includes(control.action) ? taskReview(draft, index, t) : review(actor, draft, input.locale);
  } catch (error) {
    if (draft && error instanceof KnowledgeAccessError && error.code === "changed") return review(actor, await getCaptureDraft(actor, draft.id), input.locale, t("performanceNotes.review.changed"));
    return { type: "message", content: t(error instanceof KnowledgeAccessError && error.code === "invalid" ? "performanceNotes.review.invalid" : "performanceNotes.review.unavailable") };
  }
}
