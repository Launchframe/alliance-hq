"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureCommit, IntakeResult } from "@/lib/notes/intake.shared";
import { useNoteIntake } from "./useNoteIntake";
import { useCaptureDraft } from "./useCaptureDraft";
import { automaticActionModes, draftActionIsCurrent, mergeDraftActions, updateDraftAction, type CaptureDraft, type CaptureDraftState, type DraftAction } from "@/lib/notes/drafts.shared";
import { TaskStateFields } from "./TaskStateFields";
import { NoteTasksPanel } from "./NoteTasksPanel";
import { useTranslations } from "next-intl";
import { Archive, Check, Clock3, Globe2, LockKeyhole, MessageSquare, Save, Share2, X } from "lucide-react";
import type { PerformanceNoteDto, PerformanceNoteRosterMember } from "@/lib/performance-notes/types.shared";
import { detectNoteMentions } from "@/lib/notes/mentions.shared";
import { NOTE_PRIORITIES, normalizeNoteLabels, noteTitle, type NoteFields, type NotePatch, type NotePriority } from "@/lib/notes/workspace.shared";
import { FORM_SUBMIT_ENTER_KEY_HINT, preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { NoteMarkdown } from "./NoteMarkdown";
import { NoteMemberPicker } from "./NoteMemberPicker";

const inputClass = "w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg outline-none focus:border-hq-accent focus:ring-2 focus:ring-hq-accent/15 disabled:opacity-60";
const secondary = "inline-flex items-center justify-center gap-2 rounded-lg border border-hq-border px-3 py-2 text-sm font-medium hover:bg-hq-surface disabled:opacity-50";

export function NoteEditor({ note, initialBody = "", resumeDraft, roster, onClose, onSave, onShare, onHistory }: {
  note: PerformanceNoteDto | null;
  resumeDraft?: CaptureDraft;
  initialBody?: string;
  roster: PerformanceNoteRosterMember[];
  onClose: () => void;
  onSave: (fields: NoteFields | NotePatch | CaptureCommit, noteId?: string) => Promise<void>;
  onShare: (note: PerformanceNoteDto) => void;
  onHistory: (note: PerformanceNoteDto) => void;
}) {
  const t = useTranslations("notes");
  const dialog = useRef<HTMLDialogElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const [original] = useState(note);
  const restored = resumeDraft?.state;
  const initialFields = restored?.fields;
  const editable = !note || note.canEdit;
  const owner = !note || note.isOwner;
  const [draft, setDraft] = useState(() => ({
    title: initialFields?.title ?? original?.title ?? "", body: initialFields?.body ?? original?.body ?? initialBody,
    kind: initialFields?.kind ?? original?.kind ?? "note", priority: initialFields ? initialFields.priority : original?.priority ?? null as NotePriority,
    priorityMode: initialFields?.priorityMode ?? original?.priorityMode ?? "auto" as "auto" | "manual",
    notebook: initialFields ? initialFields.notebook ?? "" : original?.notebook ?? "", journalDate: initialFields ? initialFields.journalDate ?? "" : original?.journalDate ?? "", inbox: initialFields?.inbox ?? original?.inbox ?? true,
  }));
  const [labels, setLabels] = useState((initialFields?.labels ?? original?.labels)?.join(", ") ?? "");
  const [manual, setManual] = useState(() => new Set(initialFields ? initialFields.memberIds.filter((id) => !initialFields.detectedMemberIds.includes(id)) : original?.members.filter((member) => !owner || member.origin !== "detected").map((member) => member.ashedMemberId) ?? []));
  const [excluded, setExcluded] = useState(() => new Set(initialFields?.excludedMemberIds ?? original?.excludedMemberIds ?? []));
  const [membersTouched, setMembersTouched] = useState(Boolean(restored));
  const [preview, setPreview] = useState(Boolean(original));
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyAfterConflict, setDirtyAfterConflict] = useState(false);
  const [draftId] = useState(() => resumeDraft?.id ?? crypto.randomUUID());
  const [revision, setRevision] = useState(restored?.revision ?? 0);
  const [overrideRevision, setOverrideRevision] = useState(restored?.overrideRevision ?? 0);
  const [captureAi, setCaptureAi] = useState(restored?.aiEnabled ?? true);
  const [analysisRevision, setAnalysisRevision] = useState(restored?.analysisRevision ?? -1);
  const [analysisId, setAnalysisId] = useState<string | null>(restored?.analysisId ?? null);
  const [suggestions, setSuggestions] = useState<DraftAction[]>(restored?.tasks ?? []);
  const acceptAnalysis = useCallback((result: IntakeResult) => {
    setAnalysisRevision(result.revision); setAnalysisId(result.analysisId ?? null);
    setDraft((current) => current.priorityMode === "manual" ? current : { ...current, priority: result.priority });
    setSuggestions((current) => mergeDraftActions(current, result));
  }, []);
  const intake = useNoteIntake({ draftId, body: draft.body, revision, overrideRevision, active: !original && captureAi && !saving, onResult: acceptAnalysis });
  const currentSuggestions = suggestions.filter((item) => draftActionIsCurrent(item, { analysisRevision, revision, aiEnabled: captureAi && intake.preference?.enabled === true }));
  const includedCount = currentSuggestions.filter((item) => item.included).length;
  function editSuggestion(actionKey: string, patch: Parameters<typeof updateDraftAction>[1]) {
    setOverrideRevision((value) => value + 1);
    setSuggestions((current) => current.map((item) => item.actionKey === actionKey ? updateDraftAction(item, patch) : item));
  }
  const bodyChanged = !original || draft.body !== original.body;
  const detection = useMemo(() => owner && bodyChanged ? detectNoteMentions(draft.body, roster) : { memberIds: original?.members.filter((member) => member.origin === "detected").map((member) => member.ashedMemberId) ?? [], matches: [] }, [bodyChanged, draft.body, original, owner, roster]);
  const detected = detection.memberIds.filter((id) => !excluded.has(id) && !manual.has(id));
  const selectedIds = [...new Set([...manual, ...detected])];
  const captureFields: NoteFields = { ...draft, notebook: draft.notebook.trim() || null, journalDate: draft.journalDate || null, labels: normalizeNoteLabels(labels.split(",")), memberIds: selectedIds, detectedMemberIds: detected, excludedMemberIds: [...excluded] };
  const captureState: CaptureDraftState = { fields: captureFields, revision, overrideRevision, analysisRevision, analysisId, tasks: suggestions, aiEnabled: captureAi && intake.preference?.enabled === true, archive: null };
  const completeRoster = useMemo(() => {
    const members = new Map(roster.map((member) => [member.ashedMemberId, member]));
    for (const member of original?.members ?? []) if (!members.has(member.ashedMemberId)) members.set(member.ashedMemberId, member);
    return [...members.values()];
  }, [original, roster]);
  const dirty = editable && (!original ? !!(draft.body || draft.title) : draft.title !== original.title || draft.body !== original.body || draft.kind !== original.kind || draft.priority !== original.priority || draft.notebook !== (original.notebook ?? "") || draft.journalDate !== (original.journalDate ?? "") || draft.inbox !== original.inbox || labels !== original.labels.join(", ") || membersTouched);

  const persistence = useCaptureDraft({ id: draftId, state: captureState, active: dirty && !saving, initialVersion: resumeDraft?.version, sourceNoteId: resumeDraft?.sourceNoteId ?? original?.id ?? null, sourceVersion: resumeDraft?.sourceVersion ?? original?.version ?? null });

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (!original) bodyInput.current?.focus();
    return () => element?.close();
  }, [original]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  function close() {
    if (saving) return;
    if (dirty) setDiscard(true); else onClose();
  }
  async function closeDraft(keep: boolean) {
    if (saving) return;
    setSaving(true); setError(null);
    try { if (keep) await persistence.flush(captureState); else await persistence.discard(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); setDiscard(false); }
    finally { setSaving(false); }
  }
  function addMember(id: string) {
    setMembersTouched(true);
    setManual((values) => new Set([...values, id]));
    setExcluded((values) => { const next = new Set(values); next.delete(id); return next; });
  }
  function removeMember(id: string) {
    setMembersTouched(true);
    setManual((values) => { const next = new Set(values); next.delete(id); return next; });
    setExcluded((values) => new Set([...values, id]));
  }
  async function save(archived?: boolean) {
    if (!editable || saving || !draft.body.trim()) return;
    setSaving(true); setError(null);
    try {
      const stored = await persistence.flush({ ...captureState, archive: archived ?? null });
      await onSave({ ...captureFields, requestId: draftId, draftId, expectedDraftVersion: stored.version, tasks: currentSuggestions });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("saveFailed"));
      setDirtyAfterConflict(true);
    } finally { setSaving(false); }
  }

  const SourceIcon = (resumeDraft?.source ?? original?.source) === "discord" ? MessageSquare : Globe2;
  return <dialog ref={dialog} aria-label={original ? noteTitle(original) : t("actions.newNote")} onCancel={(event) => { event.preventDefault(); if (discard) setDiscard(false); else close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(96vw,64rem)] overflow-hidden rounded-2xl border border-hq-border bg-hq-canvas p-0 text-hq-fg shadow-2xl backdrop:bg-black/60">
    {discard ? <div className="space-y-4 p-8"><h2 className="text-xl font-semibold">{t("editor.discardTitle")}</h2><p className="text-sm text-hq-fg-muted">{t("editor.discardBody")}</p><div className="flex justify-end gap-2"><button type="button" autoFocus className={secondary} onClick={() => setDiscard(false)}>{t("editor.keepEditing")}</button><button type="button" className="rounded-lg bg-hq-danger px-4 py-2 text-sm font-medium text-white" disabled={saving} onClick={() => void closeDraft(false)}>{t("editor.discard")}</button><button type="button" disabled={saving} className={secondary} onClick={() => void closeDraft(true)}>{t("drafts.keepClose")}</button></div></div> : <form onSubmit={(event) => { preventDefaultFormSubmit(event); void save(); }} className="flex max-h-[92dvh] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-hq-border px-5 py-3">
        <div className="flex min-w-0 items-center gap-3 text-xs text-hq-fg-muted"><span className="inline-flex items-center gap-1.5">{original?.shared ? <Share2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}{original?.shared ? t("sharing.shared") : t("editor.private")}</span><span className="h-3 w-px bg-hq-border" /><span className="inline-flex items-center gap-1.5"><SourceIcon className="h-3.5 w-3.5" />{t(`source.${resumeDraft?.source ?? original?.source ?? "web"}`)}</span></div>
        <div className="flex items-center gap-1">
          {note?.isOwner ? <><button type="button" disabled={dirty || saving} title={dirty ? t("editor.saveBeforeShare") : t("actions.history")} aria-label={t("actions.history")} onClick={() => onHistory(note)} className="rounded-lg p-2 text-hq-fg-muted hover:bg-hq-surface disabled:opacity-40"><Clock3 className="h-4 w-4" /></button><button type="button" disabled={dirty || saving} title={dirty ? t("editor.saveBeforeShare") : t("actions.share")} onClick={() => onShare(note)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-hq-surface disabled:opacity-40"><Share2 className="h-3.5 w-3.5" />{t("actions.share")}</button></> : null}
          <button type="button" onClick={close} aria-label={t("actions.close")} className="rounded-lg p-2 text-hq-fg-muted hover:bg-hq-surface"><X className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="min-h-0 overflow-y-auto">
        <div className="px-6 pt-6 sm:px-8"><input enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT} aria-label={t("fields.title")} placeholder={noteTitle({ body: draft.body }) || t("editor.untitled")} value={draft.title} maxLength={160} disabled={!editable || saving} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="w-full border-0 bg-transparent text-2xl font-semibold leading-tight tracking-tight outline-none placeholder:text-hq-fg-muted sm:text-3xl" /></div>
        <div className="grid gap-6 px-6 py-6 sm:grid-cols-[minmax(0,1fr)_15rem] sm:px-8">
          <div className="min-w-0 space-y-5">
            <div>
              <div className="mb-3 flex items-center gap-1 border-b border-hq-border">{editable ? [false, true].map((value) => <button key={String(value)} type="button" onClick={() => setPreview(value)} className={`border-b-2 px-3 py-2 text-xs font-medium ${preview === value ? "border-hq-accent text-hq-accent" : "border-transparent text-hq-fg-muted"}`}>{value ? t("editor.preview") : t("editor.write")}</button>) : <span className="py-2 text-xs font-medium text-hq-fg-muted">{t("bodyLabel")}</span>}</div>
              {preview || !editable ? <div className="min-h-52"><NoteMarkdown body={draft.body} /></div> : <textarea data-no-enter-submit ref={bodyInput} disabled={saving} aria-label={t("bodyLabel")} placeholder={t("editor.placeholder")} value={draft.body} maxLength={100_000} rows={12} onChange={(event) => { setRevision((value) => value + 1); setDraft({ ...draft, body: event.target.value, priority: draft.priorityMode === "auto" && !original ? null : draft.priority }); }} className="min-h-60 w-full resize-y rounded-lg border border-hq-border bg-transparent p-3 text-sm leading-7 outline-none focus:border-hq-accent focus:ring-2 focus:ring-hq-accent/10" />}
              {editable && !preview ? <p className="mt-2 text-xs text-hq-fg-muted">{t("editor.markdownHint")}</p> : null}
            </div>
            {!original || currentSuggestions.length > 0 ? <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface/50 p-4">
              {!original ? <><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={intake.enabled} disabled={!intake.preference || intake.changing || saving} onChange={(event) => void intake.setEnabled(event.target.checked)} className="accent-hq-accent" />{t("intake.enable")}</label>
              <p className="text-xs leading-5 text-hq-fg-muted">{t("intake.consent")}</p>
              {intake.preference?.enabled ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={captureAi} disabled={saving} onChange={(event) => { setCaptureAi(event.target.checked); setOverrideRevision((value) => value + 1); }} className="accent-hq-accent" />{t("intake.thisCapture")}</label> : null}
              {!intake.preference?.configured || draft.body.length > 10_000 ? <p className="text-xs text-hq-fg-muted">{t("intake.unavailable")}</p> : intake.pending ? <p role="status" className="text-xs text-hq-accent">{t("intake.analyzing")}</p> : analysisRevision === revision && !currentSuggestions.length ? <p className="text-xs text-hq-fg-muted">{t("intake.noActions")}</p> : null}
              {intake.error ? <p role="alert" className="text-xs text-hq-danger">{intake.error}</p> : null}</> : null}
              {currentSuggestions.map((item) => <div key={item.actionKey} data-testid="intake-task" className={`space-y-2 rounded-lg border border-hq-border bg-hq-canvas p-3 ${item.included ? "" : "opacity-60"}`}>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={item.included} disabled={saving} onChange={(event) => editSuggestion(item.actionKey, { included: event.target.checked })} className="accent-hq-accent" />{t("intake.includeTask")}</label>
                <input aria-label={t("tasks.title")} value={item.title} disabled={saving} maxLength={160} onChange={(event) => editSuggestion(item.actionKey, { title: event.target.value })} className={inputClass} />
                <TaskStateFields status={item.status} priority={item.priority} disabled={saving || !item.included} onStatus={(status) => editSuggestion(item.actionKey, { status })} onPriority={(priority) => editSuggestion(item.actionKey, { priority })} />
                <p className="border-l-2 border-hq-border pl-2 text-xs text-hq-fg-muted">{item.evidence}</p>
                <div className="flex items-center justify-between text-xs text-hq-fg-muted"><span>{Object.values(item.modes).includes("manual") ? t("drafts.manual") : t("drafts.detected")}</span><button disabled={saving} onClick={() => { setSuggestions((current) => current.map((task) => task.actionKey === item.actionKey ? { ...task, modes: automaticActionModes() } : task)); setOverrideRevision((value) => value + 1); }} className="text-hq-accent">{t("drafts.reset")}</button></div>
              </div>)}
              {!original && draft.priorityMode === "manual" ? <button type="button" disabled={saving} onClick={() => { setDraft((current) => ({ ...current, priorityMode: "auto" })); setOverrideRevision((value) => value + 1); }} className="text-xs text-hq-accent">{t("intake.resetPriority")}</button> : null}
            </section> : null}
            <section className="space-y-2 border-t border-hq-border pt-4"><h3 className="text-xs font-semibold text-hq-fg-muted">{t("fields.members")}</h3><NoteMemberPicker roster={completeRoster} selectedIds={selectedIds} detectedIds={detected} disabled={!editable || saving} onAdd={addMember} onRemove={removeMember} /><p className="text-xs leading-5 text-hq-fg-muted">{t("editor.memberPrivacy")}</p>{detection.matches.filter((match) => !match.automatic && !match.candidates.some((member) => selectedIds.includes(member.ashedMemberId))).map((match) => <div key={`${match.start}:${match.end}`} className="rounded-lg border border-hq-border bg-hq-surface p-3 text-xs"><p className="mb-2">{t("editor.chooseMember", { name: match.text })}</p><div className="flex flex-wrap gap-1.5">{match.candidates.map((candidate) => <button key={candidate.ashedMemberId} type="button" onClick={() => addMember(candidate.ashedMemberId)} className="rounded border border-hq-border bg-hq-canvas px-2 py-1 hover:border-hq-accent">{candidate.name}</button>)}</div></div>)}</section>
            {original ? <NoteTasksPanel sourceNoteId={original.id} /> : null}
          </div>
          <aside className="space-y-4 rounded-xl bg-hq-surface p-4 sm:self-start">
            <label className="block space-y-1.5"><span className="text-xs font-medium text-hq-fg-muted">{t("fields.priority")}</span><select aria-label={t("fields.priority")} value={draft.priority ?? "none"} disabled={!editable || saving} onChange={(event) => { setOverrideRevision((value) => value + 1); setDraft({ ...draft, priorityMode: "manual", priority: event.target.value === "none" ? null : event.target.value as NotePriority }); }} className={inputClass}>{["none", ...NOTE_PRIORITIES].map((value) => <option key={value} value={value}>{t(`priority.${value}`)}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-medium text-hq-fg-muted">{t("kindLabel")}</span><select value={draft.kind} disabled={!editable || saving} onChange={(event) => setDraft({ ...draft, kind: event.target.value as NoteFields["kind"] })} className={inputClass}><option value="note">{t("kindNote")}</option><option value="commendation">{t("kindCommendation")}</option><option value="violation">{t("kindViolation")}</option></select></label>
            <label className="block space-y-1.5"><span className="text-xs font-medium text-hq-fg-muted">{t("fields.labels")}</span><input enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT} value={labels} disabled={!editable || saving} onChange={(event) => setLabels(event.target.value)} placeholder={t("editor.labelsPlaceholder")} className={inputClass} /></label>
            {owner ? <label className="block space-y-1.5"><span className="text-xs font-medium text-hq-fg-muted">{t("fields.notebook")}</span><input enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT} value={draft.notebook} disabled={!editable || saving} maxLength={60} onChange={(event) => setDraft({ ...draft, notebook: event.target.value })} placeholder={t("editor.noNotebook")} className={inputClass} /></label> : null}
            <label className="block space-y-1.5"><span className="text-xs font-medium text-hq-fg-muted">{t("fields.journalDate")}</span><input type="date" value={draft.journalDate} disabled={!editable || saving} onChange={(event) => setDraft({ ...draft, journalDate: event.target.value })} className={inputClass} /></label>
            {owner ? <label className="flex items-center gap-2 border-t border-hq-border pt-3 text-xs"><input type="checkbox" checked={draft.inbox} disabled={!editable || saving} onChange={(event) => setDraft({ ...draft, inbox: event.target.checked })} className="accent-hq-accent" />{t("editor.keepInInbox")}</label> : null}
          </aside>
        </div>
      </div>
      <footer className="border-t border-hq-border bg-hq-canvas px-6 py-4 sm:px-8">
        {editable && persistence.status !== "idle" ? <p role="status" className="mb-2 text-xs text-hq-fg-muted">{t(`drafts.${persistence.status}`)}</p> : null}
        {persistence.error ? <p role="alert" className="mb-2 text-xs text-hq-danger">{persistence.error}</p> : null}
        {original?.intakeProvenance ? <details className="mb-2 text-xs text-hq-fg-muted"><summary>{t("drafts.provenance")}</summary><p>{original.intakeProvenance.evidence}</p><code>{original.intakeProvenance.interpreter}</code></details> : null}
        {error ? <p role="alert" className="mb-3 rounded-lg bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">{error}{dirtyAfterConflict ? <span className="mt-1 block text-xs">{t("editor.draftPreserved")}</span> : null}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3"><div>{note?.isOwner ? <button type="button" disabled={saving} onClick={() => void save(!note.archived)} className="inline-flex items-center gap-1.5 text-xs text-hq-fg-muted hover:text-hq-fg"><Archive className="h-3.5 w-3.5" />{note.archived ? t("actions.restore") : t("actions.archive")}</button> : <span className="inline-flex items-center gap-1.5 text-xs text-hq-fg-muted"><LockKeyhole className="h-3.5 w-3.5" />{t("editor.memberPrivacy")}</span>}</div><div className="flex gap-2"><button type="button" onClick={close} className={secondary}>{t("actions.close")}</button>{editable ? <button type="submit" disabled={saving || !draft.body.trim() || !!original && !dirty} className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{saving ? <Save className="h-4 w-4 animate-pulse" /> : <Check className="h-4 w-4" />}{saving ? t("saving") : !original && includedCount ? t("intake.saveTasks", { count: includedCount }) : t("saveNote")}</button> : null}</div></div>
      </footer>
    </form>}
  </dialog>;
}
