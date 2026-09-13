"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatServerCalendarDate } from "@/lib/trains/game-time";
import type { NoteTask, TaskCreate, TaskPatch } from "@/lib/notes/tasks.shared";
import type { NoteShareState } from "@/lib/notes/sharing.shared";
import { normalizeNoteLabels } from "@/lib/notes/workspace.shared";
import { TaskStateFields } from "./TaskStateFields";

export function NoteTaskEditor({ task, sourceNoteId, people, onClose, onSave }: {
  task: NoteTask | null; sourceNoteId?: string; people: NoteShareState["recipients"];
  onClose: () => void; onSave: (input: TaskCreate | TaskPatch, id?: string) => Promise<void>;
}) {
  const t = useTranslations("notes");
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({ title: task?.title ?? "", description: task?.description ?? "", status: task?.status ?? "open", priority: task?.priority ?? null, assigneeHqUserId: task?.assignee?.id ?? "", dueDate: task?.dueAt ? formatServerCalendarDate(new Date(task.dueAt)) : "", labels: task?.labels.join(", ") ?? "" });
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const editable = !task || task.canEdit;
  const owner = !task || task.isOwner;
  const inputClass = "w-full rounded-lg border border-hq-border bg-hq-canvas p-2 text-sm outline-none focus:border-hq-accent";
  function change(patch: Partial<typeof draft>) { setDraft((current) => ({ ...current, ...patch })); setDirty(true); }
  function close() { if (saving) return; if (dirty) setDiscard(true); else onClose(); }
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function save(archived?: boolean) {
    if (!editable || saving) return;
    setSaving(true); setError(null);
    try {
      const values = { title: draft.title, description: draft.description || null, status: draft.status, priority: draft.priority, assigneeHqUserId: draft.assigneeHqUserId || null, shareWithAssignee: share, dueAt: draft.dueDate ? new Date(`${draft.dueDate}T23:59:59.999-02:00`).toISOString() : null, labels: normalizeNoteLabels(draft.labels.split(",")), requestId };
      await onSave(task ? { ...values, expectedVersion: task.version, ...(archived !== undefined ? { archived } : {}) } : { ...values, sourceNoteId: sourceNoteId ?? null }, task?.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); }
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
      {owner && draft.assigneeHqUserId ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={share} disabled={saving} onChange={(event) => { setShare(event.target.checked); setDirty(true); }} />{t("tasks.shareAssignee")}</label> : null}
      <p className="text-xs leading-5 text-hq-fg-muted">{t("tasks.sourcePrivacy")}</p>
      {task?.source ? <Link href={`/notes/${task.source.id}`} className="block text-xs text-hq-accent">{task.source.title}</Link> : null}
      <footer className="sticky bottom-0 space-y-3 border-t border-hq-border bg-hq-canvas pt-3">{error ? <p role="alert" className="text-sm text-hq-danger">{error}</p> : null}<div className="flex items-center justify-between gap-2">{task?.isOwner ? <button disabled={saving} onClick={() => void save(!task.archived)} className="text-xs text-hq-fg-muted">{t(task.archived ? "tasks.restore" : "tasks.archive")}</button> : <span />}<div className="flex gap-2"><button disabled={saving} onClick={close} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("actions.close")}</button>{editable ? <button disabled={saving || !draft.title.trim()} onClick={() => void save()} className="rounded-lg bg-hq-accent px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("saving") : t("tasks.save")}</button> : null}</div></div></footer>
    </div>}
  </dialog>;
}
