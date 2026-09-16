"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FORM_SUBMIT_ENTER_KEY_HINT, handleTextareaEnterSubmit, preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type { PerformanceNoteDto, PerformanceNoteSummary, NotesListPage } from "@/lib/performance-notes/types.shared";
import { noteListFilterSchema, noteListUrl } from "@/lib/notes/workspace.shared";
import type { Publication } from "@/lib/notes/publications.shared";
import { NoteMarkdown } from "./NoteMarkdown";

export function NotePublications({ scope }: { scope: string }) {
  const t = useTranslations("notes.publications"), n = useTranslations("notes"), locale = useLocale();
  const [id, setId] = useState(""), [title, setTitle] = useState(""), [body, setBody] = useState(""), [days, setDays] = useState(7);
  const [preview, setPreview] = useState<Publication | null>(null), [items, setItems] = useState<Publication[]>([]), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const selected = useRef("");
  const mutationRevision = useRef(0);
  const [source, setSource] = useState<PerformanceNoteDto | null>(null);
  const [notes, setNotes] = useState<PerformanceNoteSummary[]>([]), [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null), [previousPages, setPreviousPages] = useState<Array<string | null>>([]);
  const [listing, setListing] = useState(true), [choiceError, setChoiceError] = useState<string | null>(null);
  const position = useRef<string | null>(null), listRequest = useRef<AbortController | null>(null), noteRequest = useRef<AbortController | null>(null);
  const errorAnchor = useRef<HTMLParagraphElement>(null);
  const clear = useCallback(() => { mutationRevision.current++; selected.current = ""; setId(""); setSource(null); setTitle(""); setBody(""); setPreview(null); setItems([]); setReviewed(false); }, []);
  const loadChoices = useCallback(async (cursor: string | null = null) => {
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    setListing(true); setChoiceError(null);
    try {
      const response = await fetch(noteListUrl(noteListFilterSchema.parse({ q: query }), cursor), { cache: "no-store", signal: controller.signal });
      const page: NotesListPage & { error?: string } = await response.json();
      if (controller.signal.aborted) return false;
      if (!response.ok || page.scope !== scope) {
        if ([401, 403].includes(response.status) || response.ok && page.scope !== scope) { setNotes([]); clear(); }
        throw new Error(page.error ?? n("loadFailed"));
      }
      position.current = cursor; setNotes(page.items); setNextCursor(page.nextCursor);
      if (cursor === null) setPreviousPages([]);
      return true;
    } catch (failure) { if (!controller.signal.aborted) setChoiceError(failure instanceof Error ? failure.message : n("loadFailed")); return false; }
    finally { if (!controller.signal.aborted) setListing(false); }
  }, [query, scope, n, clear]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadChoices(); }, 200);
    return () => { window.clearTimeout(timer); listRequest.current?.abort(); };
  }, [loadChoices]);
  useEffect(() => () => { noteRequest.current?.abort(); }, []);
  useEffect(() => { if (error) errorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const ready = !!source;
  useEffect(() => {
    if (!id || !ready) return;
    const controller = new AbortController();
    const refresh = async () => {
      const revision = mutationRevision.current;
      try {
        const [detail, response] = await Promise.all([fetch(`/api/notes/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }), fetch(`/api/notes/publications?noteId=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })]);
        const [note, value] = await Promise.all([detail.json(), response.json()]);
        if (controller.signal.aborted || selected.current !== id) return;
        if ([401, 403, 404].includes(detail.status) || detail.ok && (note.scope !== scope || !note.note.isOwner || note.note.archived)) { clear(); return; }
        if (!detail.ok || !response.ok) { setError(value.error ?? note.error ?? n("loadFailed")); return; }
        if (revision === mutationRevision.current) setItems(value);
      } catch { if (!controller.signal.aborted) setError(n("loadFailed")); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [id, ready, scope, n, clear]);
  async function choose(noteId: string) {
    noteRequest.current?.abort(); clear(); setChoiceError(null);
    if (!noteId) return;
    const controller = new AbortController(); noteRequest.current = controller;
    selected.current = noteId; setId(noteId); setBusy(true);
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, { cache: "no-store", signal: controller.signal });
      const value = await response.json();
      if (controller.signal.aborted || selected.current !== noteId) return;
      if (!response.ok || value.scope !== scope || !value.note.isOwner || value.note.archived) throw new Error(value.error ?? n("notFound"));
      const note: PerformanceNoteDto = value.note;
      setSource(note); setTitle(note.title); setBody([note.body, ...(note.keyDecisions ?? []), ...(note.openQuestions ?? [])].join("\n\n"));
    } catch (failure) { if (!controller.signal.aborted) { clear(); setChoiceError(failure instanceof Error ? failure.message : n("loadFailed")); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function post(url: string, value: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? n("saveFailed")), { status: response.status });
    return result as Publication;
  }
  async function run(action: () => Promise<Publication>) {
    const target = id;
    mutationRevision.current++;
    setBusy(true); setError(null);
    try { const value = await action(); if (selected.current === target) { setPreview(value); setReviewed(false); setItems((current) => [value, ...current.filter((item) => item.id !== value.id)]); } }
    catch (failure) { if (selected.current === target) { setError(failure instanceof Error ? failure.message : n("saveFailed")); setPreview(null); if (failure && typeof failure === "object" && "status" in failure && [401, 403, 404].includes(Number(failure.status))) { clear(); } } }
    finally { mutationRevision.current++; setBusy(false); }
  }
  const command = (item: Publication, command: "publish" | "revoke" | "rotate") => run(() => post(`/api/notes/publications/${item.id}`, { requestId: crypto.randomUUID(), expectedVersion: item.version, command, reviewed }));
  const change = () => { setPreview(null); setReviewed(false); };
  const cls = "rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm disabled:opacity-40";
  return <section data-testid="notes-publications" className="min-w-0 flex-1 space-y-5 p-5 sm:p-7"><h2 className="text-xl font-semibold">{t("title")}</h2><p className="text-sm text-hq-fg-muted">{t("hint")}</p>
    <div className="space-y-3">
      <input type="search" maxLength={200} aria-label={n("workspace.search")} placeholder={n("workspace.search")} value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setListing(true); }} className={cls} />
      <label className="block text-sm">{t("note")}<select aria-label={t("note")} value={id} disabled={busy || listing} className={`${cls} ml-3`} onChange={(event) => void choose(event.target.value)}><option value="">—</option>{source && !notes.some((note) => note.id === id) && <option value={id}>{source.title || n("editor.untitled")}</option>}{notes.map((note) => <option value={note.id} key={note.id}>{note.title || n("editor.untitled")}</option>)}</select></label>
      <div className="flex gap-2"><button type="button" className={cls} disabled={busy || listing || !previousPages.length} onClick={() => void loadChoices(previousPages.at(-1) ?? null).then((loaded) => { if (loaded) setPreviousPages((pages) => pages.slice(0, -1)); })}>{n("imports.previous")}</button><button type="button" className={cls} disabled={busy || listing || !nextCursor} onClick={() => { const previous = position.current; void loadChoices(nextCursor).then((loaded) => { if (loaded) setPreviousPages((pages) => [...pages, previous]); }); }}>{n("imports.next")}</button></div>
      {choiceError && <p role="alert" className="text-sm text-hq-danger">{choiceError}</p>}
    </div>
    {source && <><form className="space-y-4" onSubmit={(event) => { preventDefaultFormSubmit(event); if (busy || !title.trim() || !body.trim()) return; void run(() => post("/api/notes/publications", { requestId: crypto.randomUUID(), noteId: id, expectedVersion: source.version, title, body, locale, days })); }}><label className="block text-sm">{t("publicTitle")}<input className={`${cls} mt-2 w-full`} value={title} maxLength={160} disabled={busy} onChange={(event) => { setTitle(event.target.value); change(); }} /></label><label className="block text-sm">{t("publicBody")}<textarea className={`${cls} mt-2 w-full`} rows={12} value={body} maxLength={100000} disabled={busy} enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT} onKeyDown={(event) => handleTextareaEnterSubmit(event, () => { if (!busy && title.trim() && body.trim()) void run(() => post("/api/notes/publications", { requestId: crypto.randomUUID(), noteId: id, expectedVersion: source.version, title, body, locale, days })); })} onChange={(event) => { setBody(event.target.value); change(); }} /></label><label className="block text-sm">{t("days")}<select className={`${cls} ml-3`} value={days} disabled={busy} onChange={(event) => { setDays(Number(event.target.value)); change(); }}>{[1, 7, 30].map((value) => <option key={value} value={value}>{t("lifetime", { days: value })}</option>)}</select></label><button type="submit" className={cls} disabled={busy || !title.trim() || !body.trim()}>{t("preview")}</button></form><p className="text-xs text-hq-fg-muted">{t("privacy")}</p>
    {preview?.state === "draft" && <section data-testid="publication-preview" className="space-y-4 rounded-xl border border-hq-border p-5"><h3 className="text-2xl font-semibold">{preview.title}</h3><NoteMarkdown body={preview.body} allowLinks={false} /><p className="text-xs">{t("expires", { date: new Date(preview.expiresAt).toLocaleString(locale) })}</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t("reviewed")}</label><button type="button" className={cls} disabled={busy || !reviewed} onClick={() => void command(preview, "publish")}>{t("publish")}</button></section>}
    <div className="space-y-3">{items.filter((item) => item.noteId === id).map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-hq-border p-4"><h3 className="font-semibold">{item.title} · {t("version", { version: item.snapshotVersion })}</h3><p className="text-xs">{t(`states.${item.state}`)} · {t("expires", { date: new Date(item.expiresAt).toLocaleString(locale) })}</p><div className="flex flex-wrap gap-2">{item.link && <><a className={cls} href={item.link} target="_blank" rel="noopener noreferrer">{t("open")}</a><button type="button" className={cls} onClick={() => void navigator.clipboard.writeText(new URL(item.link!, window.location.origin).href).catch(() => setError(n("saveFailed")))}>{t("copy")}</button><button type="button" className={cls} disabled={busy} onClick={() => void command(item, "rotate")}>{t("rotate")}</button></>}{item.state !== "revoked" && <button type="button" className={cls} disabled={busy} onClick={() => void command(item, "revoke")}>{t("revoke")}</button>}</div></article>)}</div></>}
    {error && <p ref={errorAnchor} role="alert" className="text-sm text-hq-danger">{error}</p>}
  </section>;
}
