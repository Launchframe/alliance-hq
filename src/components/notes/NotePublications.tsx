"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PerformanceNoteDto } from "@/lib/performance-notes/types.shared";
import type { Publication } from "@/lib/notes/publications.shared";
import { NoteMarkdown } from "./NoteMarkdown";

export function NotePublications({ notes }: { notes: PerformanceNoteDto[] }) {
  const t = useTranslations("notes.publications"), n = useTranslations("notes"), locale = useLocale();
  const [id, setId] = useState(""), [title, setTitle] = useState(""), [body, setBody] = useState(""), [days, setDays] = useState(7);
  const [preview, setPreview] = useState<Publication | null>(null), [items, setItems] = useState<Publication[]>([]), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const selected = useRef("");
  const source = notes.find((note) => note.id === id && note.isOwner);
  useEffect(() => {
    if (!id || !source) return;
    const controller = new AbortController();
    fetch(`/api/notes/publications?noteId=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json();
      if (!controller.signal.aborted && selected.current === id) { if (response.ok) setItems(value); else { setItems([]); setPreview(null); setError(value.error ?? n("loadFailed")); } }
    }).catch(() => { if (!controller.signal.aborted) setError(n("loadFailed")); });
    return () => controller.abort();
  }, [id, source, n]);
  async function post(url: string, value: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error ?? n("saveFailed")), { status: response.status });
    return result as Publication;
  }
  async function run(action: () => Promise<Publication>) {
    const target = id;
    setBusy(true); setError(null);
    try { const value = await action(); if (selected.current === target) { setPreview(value); setReviewed(false); setItems((current) => [value, ...current.filter((item) => item.id !== value.id)]); } }
    catch (failure) { if (selected.current === target) { setError(failure instanceof Error ? failure.message : n("saveFailed")); setPreview(null); if (failure && typeof failure === "object" && "status" in failure && [401, 403, 404].includes(Number(failure.status))) { selected.current = ""; setId(""); setItems([]); setTitle(""); setBody(""); } } }
    finally { setBusy(false); }
  }
  const command = (item: Publication, command: "publish" | "revoke" | "rotate") => run(() => post(`/api/notes/publications/${item.id}`, { requestId: crypto.randomUUID(), expectedVersion: item.version, command, reviewed }));
  const change = () => { setPreview(null); setReviewed(false); };
  const cls = "rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm disabled:opacity-40";
  return <section data-testid="notes-publications" className="min-w-0 flex-1 space-y-5 p-5 sm:p-7"><h2 className="text-xl font-semibold">{t("title")}</h2><p className="text-sm text-hq-fg-muted">{t("hint")}</p>
    <label className="block text-sm">{t("note")}<select aria-label={t("note")} value={source ? id : ""} disabled={busy} className={`${cls} ml-3`} onChange={(event) => { const note = notes.find((item) => item.id === event.target.value); selected.current = note?.id ?? ""; setId(note?.id ?? ""); setTitle(note?.title ?? ""); setBody(note ? [note.body, ...(note.keyDecisions ?? []), ...(note.openQuestions ?? [])].join("\n\n") : ""); setItems([]); change(); }}><option value="">—</option>{notes.filter((note) => note.isOwner && !note.archived).map((note) => <option value={note.id} key={note.id}>{note.title || n("editor.untitled")}</option>)}</select></label>
    {source && <><label className="block text-sm">{t("publicTitle")}<input className={`${cls} mt-2 w-full`} value={title} maxLength={160} disabled={busy} onChange={(event) => { setTitle(event.target.value); change(); }} /></label><label className="block text-sm">{t("publicBody")}<textarea className={`${cls} mt-2 w-full`} rows={12} value={body} maxLength={100000} disabled={busy} onChange={(event) => { setBody(event.target.value); change(); }} /></label><label className="block text-sm">{t("days")}<select className={`${cls} ml-3`} value={days} disabled={busy} onChange={(event) => { setDays(Number(event.target.value)); change(); }}>{[1, 7, 30].map((value) => <option key={value} value={value}>{t("lifetime", { days: value })}</option>)}</select></label><button className={cls} disabled={busy || !title.trim() || !body.trim()} onClick={() => void run(() => post("/api/notes/publications", { requestId: crypto.randomUUID(), noteId: id, expectedVersion: source.version, title, body, locale, days }))}>{t("preview")}</button><p className="text-xs text-hq-fg-muted">{t("privacy")}</p>
    {preview?.state === "draft" && <section data-testid="publication-preview" className="space-y-4 rounded-xl border border-hq-border p-5"><h3 className="text-2xl font-semibold">{preview.title}</h3><NoteMarkdown body={preview.body} allowLinks={false} /><p className="text-xs">{t("expires", { date: new Date(preview.expiresAt).toLocaleString(locale) })}</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />{t("reviewed")}</label><button className={cls} disabled={busy || !reviewed} onClick={() => void command(preview, "publish")}>{t("publish")}</button></section>}
    <div className="space-y-3">{items.filter((item) => item.noteId === id).map((item) => <article key={item.id} className="space-y-2 rounded-lg border border-hq-border p-4"><h3 className="font-semibold">{item.title} · {t("version", { version: item.snapshotVersion })}</h3><p className="text-xs">{t(`states.${item.state}`)} · {t("expires", { date: new Date(item.expiresAt).toLocaleString(locale) })}</p><div className="flex flex-wrap gap-2">{item.link && <><a className={cls} href={item.link} target="_blank" rel="noopener noreferrer">{t("open")}</a><button className={cls} onClick={() => void navigator.clipboard.writeText(new URL(item.link!, window.location.origin).href).catch(() => setError(n("saveFailed")))}>{t("copy")}</button><button className={cls} disabled={busy} onClick={() => void command(item, "rotate")}>{t("rotate")}</button></>}{item.state !== "revoked" && <button className={cls} disabled={busy} onClick={() => void command(item, "revoke")}>{t("revoke")}</button>}</div></article>)}</div></>}
    {error && <p role="alert" className="text-sm text-hq-danger">{error}</p>}
  </section>;
}
