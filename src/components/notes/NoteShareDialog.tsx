"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LockKeyhole, Share2, Users, X } from "lucide-react";
import type { PerformanceNoteDto } from "@/lib/performance-notes/types.shared";
import type { NoteShareInput, NoteShareState } from "@/lib/notes/sharing.shared";
import { noteTitle } from "@/lib/notes/workspace.shared";

export function NoteShareDialog({ note, onClose, onSaved }: { note: PerformanceNoteDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useTranslations("notes");
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<NoteShareState | null>(null);
  const [grants, setGrants] = useState<NoteShareInput["grants"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/notes/${note.id}/sharing`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? t("loadFailed"));
        if (!controller.signal.aborted) { setData(body); setGrants(body.grants); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); }
    })();
    return () => { controller.abort(); element?.close(); };
  }, [note.id, t]);
  function remove(subjectKind: string, subjectId: string) { setGrants((values) => values.filter((grant) => grant.subjectKind !== subjectKind || grant.subjectId !== subjectId)); }
  function setRole(subjectKind: string, subjectId: string, role: "read" | "edit") { setGrants((values) => values.map((grant) => grant.subjectKind === subjectKind && grant.subjectId === subjectId ? { ...grant, role } : grant)); }
  async function save() {
    if (!data || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/notes/${note.id}/sharing`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: data.version, grants }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("saveFailed"));
      await onSaved();
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); }
    finally { setSaving(false); }
  }
  const available = data?.recipients.filter((person) => !grants.some((grant) => grant.subjectKind === "user" && grant.subjectId === person.id)) ?? [];
  return <dialog ref={dialog} aria-label={t("sharing.title")} onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="fixed inset-0 m-auto w-[min(95vw,32rem)] rounded-2xl border border-hq-border bg-hq-canvas p-0 text-hq-fg shadow-2xl backdrop:bg-black/60">
    <header className="flex items-center justify-between border-b border-hq-border px-6 py-4"><div><h2 className="font-semibold">{t("sharing.title")}</h2><p className="mt-1 max-w-80 truncate text-xs text-hq-fg-muted">{noteTitle(note)}</p></div><button onClick={onClose} disabled={saving} aria-label={t("actions.close")} className="rounded-lg p-2 hover:bg-hq-surface"><X className="h-4 w-4" /></button></header>
    <div className="space-y-5 p-6">
      <div className="flex items-start gap-3 rounded-xl bg-hq-surface p-4"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-hq-accent" /><p className="text-xs leading-5 text-hq-fg-muted">{t("sharing.explanation")}</p></div>
      {data ? <>
        <label className="block space-y-2"><span className="text-xs font-semibold">{t("sharing.addPeople")}</span><select aria-label={t("sharing.addPeople")} value="" disabled={!available.length || saving} onChange={(event) => { if (event.target.value) setGrants((values) => [...values, { subjectKind: "user", subjectId: event.target.value, role: "read" }]); }} className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm"><option value="">{t("sharing.choosePerson")}</option>{available.map((person) => <option key={person.id} value={person.id}>{person.name ?? t("sharing.unnamedMember")}</option>)}</select></label>
        <label className="flex items-center gap-3 rounded-lg border border-hq-border p-3 text-sm"><input type="checkbox" disabled={saving} checked={grants.some((grant) => grant.subjectKind === "officers")} onChange={(event) => { if (event.target.checked) setGrants((values) => [...values, { subjectKind: "officers", subjectId: data.allianceId, role: "read" }]); else setGrants((values) => values.filter((grant) => grant.subjectKind !== "officers")); }} className="accent-hq-accent" /><Users className="h-4 w-4 text-hq-fg-muted" />{t("sharing.allOfficers")}</label>
        <div className="space-y-2">{grants.length ? grants.map((grant) => {
          const name = grant.subjectKind === "officers" ? t("sharing.allOfficers") : data.recipients.find((person) => person.id === grant.subjectId)?.name ?? t("sharing.unnamedMember");
          return <div key={`${grant.subjectKind}:${grant.subjectId}`} className="flex items-center gap-2 rounded-lg bg-hq-surface p-3"><span className="min-w-0 flex-1 truncate text-sm">{name}</span><select aria-label={t("sharing.permissionFor", { name })} disabled={saving} value={grant.role} onChange={(event) => setRole(grant.subjectKind, grant.subjectId, event.target.value as "read" | "edit")} className="rounded-md border border-hq-border bg-hq-canvas px-2 py-1 text-xs"><option value="read">{t("sharing.canRead")}</option><option value="edit">{t("sharing.canEdit")}</option></select><button type="button" disabled={saving} aria-label={t("sharing.removePerson", { name })} onClick={() => remove(grant.subjectKind, grant.subjectId)} className="rounded p-1 text-hq-fg-muted hover:text-hq-danger"><X className="h-4 w-4" /></button></div>;
        }) : <p className="flex items-center gap-2 py-2 text-sm text-hq-fg-muted"><LockKeyhole className="h-4 w-4" />{t("editor.private")}</p>}</div>
      </> : <p className="text-sm text-hq-fg-muted">{t("sharing.loading")}</p>}
      {error ? <p role="alert" className="rounded-lg bg-hq-danger/10 p-3 text-sm text-hq-danger">{error}</p> : null}
    </div>
    <footer className="flex justify-end gap-2 border-t border-hq-border px-6 py-4"><button onClick={onClose} disabled={saving} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("actions.close")}</button><button onClick={() => void save()} disabled={!data || saving} className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Share2 className="h-4 w-4" />{saving ? t("saving") : t("sharing.save")}</button></footer>
  </dialog>;
}
