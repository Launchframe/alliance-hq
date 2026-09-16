"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatAccountDate } from "@/lib/timezone/format";
import { Link } from "@/i18n/navigation";
import { formatServerCalendarDate } from "@/lib/trains/game-time";
import type { NoteTask, TaskCreate, TaskPatch } from "@/lib/notes/tasks.shared";
import type { NoteShareState } from "@/lib/notes/sharing.shared";
import { normalizeNoteLabels } from "@/lib/notes/workspace.shared";
import { TaskStateFields } from "./TaskStateFields";
import { useNotesDirtyState, useNotesFetch } from "./NotesNavigation";

function taskEditorFields(task: NoteTask | null) {
  return { title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? "open" as const, priority: task?.priority ?? null, assigneeHqUserId: task?.assignee?.id ?? "", dueDate: task?.dueAt ? formatServerCalendarDate(new Date(task.dueAt)) : "", labels: task?.labels.join(", ") ?? "" };
}

export function NoteTaskEditor({ task, sourceNoteId, boardName, people, onClose, onSave }: {
  task: NoteTask | null; sourceNoteId?: string; boardName?: string; people: NoteShareState["recipients"];
  onClose: () => void; onSave: (input: TaskCreate | TaskPatch, id?: string) => Promise<void>;
}) {
  const t = useTranslations("notes");
  const locale = useLocale();
  const fetchNotes = useNotesFetch();
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [expectedVersion, setExpectedVersion] = useState(task?.version ?? 1);
  const [latest, setLatest] = useState<NoteTask | null>(null);
  const [changedFields, setChangedFields] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => taskEditorFields(task));
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  useNotesDirtyState({ dirty: dirty || saving, busy: saving, keys: sourceNoteId ? ["pathname", "note", "draft", "noteTask"] : ["pathname", "view", "board", "task"] });
  const editable = !task || task.canEdit;
  const owner = !task || task.isOwner;
  const inputClass = "w-full rounded-lg border border-hq-border bg-hq-canvas p-2 text-sm outline-none focus:border-hq-accent";
  function change(patch: Partial<typeof draft>) { setDraft((current) => ({ ...current, ...patch })); setChangedFields((current) => [...new Set([...current, ...Object.keys(patch)])]); setDirty(true); }
  function close() { if (saving) return; if (dirty) setDiscard(true); else onClose(); }
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function save(archived?: boolean) {
    if (!editable || saving) return;
    setSaving(true); setError(null);
    try {
      const values = { title: draft.title, description: draft.description || null, status: draft.status, priority: draft.priority, assigneeHqUserId: draft.assigneeHqUserId || null, shareWithAssignee: share, dueAt: draft.dueDate ? new Date(`${draft.dueDate}T23:59:59.999-02:00`).toISOString() : null, labels: normalizeNoteLabels(draft.labels.split(",")), requestId };
      const patch = Object.fromEntries(Object.entries(values).filter(([key]) => key === "requestId" || key === "shareWithAssignee" || changedFields.includes(key === "dueAt" ? "dueDate" : key)));
      await onSave(task ? { ...patch, expectedVersion, ...(archived !== undefined ? { archived } : {}) } : { ...values, sourceNoteId: sourceNoteId ?? null }, task?.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); }
    finally { setSaving(false); }
  }
  async function reviewLatest() {
    if (!task || saving) return;
    setSaving(true);
    try {
      const response = await fetchNotes(`/api/notes/tasks/${task.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t("loadFailed"));
      setLatest(payload.task);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("loadFailed")); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} aria-label={t(task ? "tasks.edit" : "tasks.new")} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (discard) setDiscard(false); else close(); }} className="fixed inset-0 m-auto max-h-[92dvh] w-[min(95vw,38rem)] overflow-y-auto rounded-2xl border border-hq-border bg-hq-canvas p-6 text-hq-fg shadow-2xl backdrop:bg-black/60">
    {discard ? <div className="space-y-4"><h2 className="font-semibold">{t("editor.discardTitle")}</h2><p className="text-sm">{t("editor.discardBody")}</p><div className="flex justify-end gap-2"><button onClick={() => setDiscard(false)} className="rounded border border-hq-border p-2">{t("editor.keepEditing")}</button><button onClick={onClose} className="rounded bg-hq-danger p-2 text-white">{t("editor.discard")}</button></div></div> : <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t(task ? "tasks.edit" : "tasks.new")}</h2>
      <label className="block space-y-1 text-xs"><span>{t("tasks.title")}</span><input autoFocus value={draft.title} maxLength={160} disabled={!editable || saving} onChange={(event) => change({ title: event.target.value })} className={inputClass} /></label>
      <label className="block space-y-1 text-xs"><span>{t("tasks.description")}</span><textarea value={draft.description} rows={4} maxLength={8_000} disabled={!editable || saving} onChange={(event) => change({ description: event.target.value })} className={inputClass} /></label>
      <TaskStateFields status={draft.status} priority={draft.priority} disabled={!editable || saving} onStatus={(status) => change({ status })} onPriority={(priority) => change({ priority })} />
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1 text-xs"><span>{t("tasks.assignee")}</span><select aria-label={t("tasks.assignee")} value={draft.assigneeHqUserId} disabled={!editable || saving} onChange={(event) => change({ assigneeHqUserId: event.target.value })} className={inputClass}><option value="">{t("tasks.unassigned")}</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name ?? t("sharing.unnamedMember")}</option>)}</select></label><label className="block space-y-1 text-xs"><span>{t("tasks.dueDate")}</span><input type="date" value={draft.dueDate} disabled={!editable || saving} onChange={(event) => change({ dueDate: event.target.value })} className={inputClass} /></label></div>
      <label className="block space-y-1 text-xs"><span>{t("fields.labels")}</span><input value={draft.labels} disabled={!editable || saving} onChange={(event) => change({ labels: event.target.value })} className={inputClass} /></label>
      {owner && draft.assigneeHqUserId ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={share} disabled={saving} onChange={(event) => { setShare(event.target.checked); change({ assigneeHqUserId: draft.assigneeHqUserId }); }} />{t("tasks.shareAssignee")}</label> : null}
      <p className="text-xs leading-5 text-hq-fg-muted">{boardName ? t("boards.saveContext", { board: boardName }) : t("tasks.sourcePrivacy")}</p>
      {task?.source ? <Link href={`/notes/${task.source.id}`} className="block text-xs text-hq-accent">{task.source.title}</Link> : null}
      {latest ? <section className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-3" aria-label={t("tasks.latestVersion")}><h3 className="text-sm font-semibold">{t("tasks.latestVersion")}</h3><p className="font-medium">{latest.title}</p>{latest.description ? <p className="whitespace-pre-wrap text-sm">{latest.description}</p> : null}<p className="text-xs">{t(`tasks.status.${latest.status}`)} · {t(`priority.${latest.priority ?? "none"}`)} · {latest.assignee?.name ?? t("tasks.unassigned")}</p>{latest.dueAt ? <p className="text-xs">{formatAccountDate(latest.dueAt, { locale, timezoneId: "server", dateStyle: "medium" })}</p> : null}<p className="text-xs">{latest.labels.join(", ")}</p><p className="text-xs text-hq-fg-muted">{t("tasks.reapplyHint")}</p><button disabled={!latest.canEdit || saving} onClick={() => { setDraft((current) => ({ ...taskEditorFields(latest), ...Object.fromEntries(changedFields.map((key) => [key, current[key as keyof typeof current]])) })); setExpectedVersion(latest.version); setRequestId(crypto.randomUUID()); setLatest(null); setError(null); }} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("tasks.keepChanges")}</button></section> : error && task ? <button disabled={saving} onClick={() => void reviewLatest()} className="text-sm text-hq-accent">{t("tasks.reviewLatest")}</button> : null}
      <footer className="sticky bottom-0 space-y-3 border-t border-hq-border bg-hq-canvas pt-3">{error ? <p role="alert" className="text-sm text-hq-danger">{error}</p> : null}<div className="flex items-center justify-between gap-2">{task?.isOwner ? <button disabled={saving} onClick={() => void save(!task.archived)} className="text-xs text-hq-fg-muted">{t(task.archived ? "tasks.restore" : "tasks.archive")}</button> : <span />}<div className="flex gap-2"><button disabled={saving} onClick={close} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("actions.close")}</button>{editable ? <button disabled={saving || !draft.title.trim()} onClick={() => void save()} className="rounded-lg bg-hq-accent px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("saving") : t(boardName && !task ? "boards.saveTask" : "tasks.save")}</button> : null}</div></div></footer>
    </div>}
  </dialog>;
}
