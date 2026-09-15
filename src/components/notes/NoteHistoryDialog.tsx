"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Clock3, RotateCcw, X } from "lucide-react";
import type { PerformanceNoteDto } from "@/lib/performance-notes/types.shared";
import { noteTitle, type NoteFields, type NotePatch } from "@/lib/notes/workspace.shared";
import { NoteMarkdown } from "./NoteMarkdown";

type Revision = { id: string; version: number; editedAt: string; snapshot: NoteFields & { archived: boolean } };

export function NoteHistoryDialog({ note, onClose, onRestore }: { note: PerformanceNoteDto; onClose: () => void; onRestore: (patch: NotePatch, noteId: string) => Promise<void> }) {
  const t = useTranslations("notes");
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selected, setSelected] = useState<Revision | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/notes/${note.id}/history`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? t("loadFailed"));
        if (!controller.signal.aborted) setRevisions(body.revisions);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { controller.abort(); element?.close(); };
  }, [note.id, t]);
  async function restore() {
    if (!selected || saving) return;
    setSaving(true); setError(null);
    try { await onRestore({ ...selected.snapshot, expectedVersion: note.version }, note.id); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} aria-label={t("actions.history")} onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(95vw,54rem)] overflow-hidden rounded-2xl border border-hq-border bg-hq-canvas p-0 text-hq-fg shadow-2xl backdrop:bg-black/60">
    <header className="flex items-center justify-between border-b border-hq-border px-6 py-4"><div><h2 className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />{t("actions.history")}</h2><p className="mt-1 text-xs text-hq-fg-muted">{t("history.private")}</p></div><button onClick={onClose} disabled={saving} aria-label={t("actions.close")} className="rounded-lg p-2 hover:bg-hq-surface"><X className="h-4 w-4" /></button></header>
    <div className="grid max-h-[65dvh] gap-0 overflow-y-auto sm:grid-cols-[14rem_minmax(0,1fr)]"><aside className="space-y-1 border-b border-hq-border bg-hq-surface p-3 sm:border-r sm:border-b-0">{loading ? <p className="p-3 text-xs text-hq-fg-muted">{t("history.loading")}</p> : !revisions.length ? <p className="p-3 text-sm text-hq-fg-muted">{t("history.empty")}</p> : revisions.map((revision) => <button key={revision.id} onClick={() => setSelected(revision)} className={`w-full rounded-lg p-3 text-left ${selected?.id === revision.id ? "bg-hq-accent/10 text-hq-accent" : "hover:bg-hq-surface-muted"}`}><p className="truncate text-sm font-medium">{t("history.version", { version: revision.version })}</p><p className="mt-1 text-xs text-hq-fg-muted">{new Date(revision.editedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</p></button>)}</aside><section className="min-h-48 min-w-0 p-6">{selected ? <><h3 className="mb-4 text-xl font-semibold">{noteTitle(selected.snapshot)}</h3><NoteMarkdown body={selected.snapshot.body} /></> : <p className="text-sm text-hq-fg-muted">{t("history.choose")}</p>}</section></div>
    <footer className="space-y-3 border-t border-hq-border px-6 py-4">{selected ? <p className="text-xs leading-5 text-hq-fg-muted">{t("history.restoreHint")}</p> : null}{error ? <p role="alert" className="text-sm text-hq-danger">{error}</p> : null}<div className="flex justify-end gap-2"><button onClick={onClose} disabled={saving} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("actions.close")}</button><button disabled={!selected || saving} onClick={() => void restore()} className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"><RotateCcw className="h-4 w-4" />{saving ? t("saving") : t("history.restore")}</button></div></footer>
  </dialog>;
}
