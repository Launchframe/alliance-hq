"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { NoteSearchInput, NoteSearchResponse } from "@/lib/notes/search.shared";

export function NoteWorkspaceSearch() {
  const t = useTranslations("notes.searchWorkspace");
  const notesT = useTranslations("notes");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<NoteSearchInput["kind"]>("all");
  const [data, setData] = useState<NoteSearchResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  const search = useCallback(async (next = 0) => {
    active.current = true;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null); setData(null);
    try {
      const params = new URLSearchParams({ q: query, kind, offset: String(next), limit: "25" });
      const response = await fetch(`/api/notes/search?${params}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok || !body) { setError(body?.error ?? notesT("loadFailed")); return; }
      setData(body); setOffset(next);
    } catch { if (!controller.signal.aborted) setError(notesT("loadFailed")); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [query, kind, notesT]);
  useEffect(() => {
    const refresh = () => { if (active.current) void search(offset); };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [offset, search]);
  const control = "rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm disabled:opacity-50";
  return <section data-testid="notes-search" className="min-w-0 flex-1 space-y-5 p-5 sm:p-7">
    <h2 className="text-lg font-semibold">{t("title")}</h2><p className="text-sm text-hq-fg-muted">{t("hint")}</p>
    <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="space-y-3">
      <div className="flex flex-wrap gap-2"><input aria-label={t("query")} required maxLength={200} value={query} onChange={(event) => { active.current = false; request.current?.abort(); setBusy(false); setData(null); setQuery(event.target.value); }} className={`${control} min-w-48 flex-1`} />
        <select aria-label={t("kind")} value={kind} onChange={(event) => { active.current = false; request.current?.abort(); setBusy(false); setData(null); setKind(event.target.value as NoteSearchInput["kind"]); }} className={control}>{(["all", "note", "task", "source"] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}</select><button className={control} disabled={busy || !query.trim()}>{busy ? t("searching") : t("submit")}</button></div>
      {error && <p role="alert" className="text-sm text-hq-danger">{error}</p>}
    </form>
    {data && !data.results.length && <p className="text-sm text-hq-fg-muted">{t("empty")}</p>}
    <div className="space-y-3">{data?.results.map((row) => <article key={`${row.kind}:${row.id}`} className="space-y-2 rounded-xl border border-hq-border bg-hq-canvas p-4"><p className="text-xs text-hq-fg-muted">{t(row.kind)}</p><h3 className="font-semibold">{row.title}</h3><p className="whitespace-pre-wrap break-words text-sm text-hq-fg-muted">{row.excerpt}</p>{row.sourceDate && <p className="text-xs">{t("sourceDate")}: {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.sourceDate))}</p>}{row.href && <Link href={row.href} className="text-sm text-hq-accent">{t("open")}</Link>}</article>)}</div>
    {data && <div className="flex gap-2"><button className={control} disabled={busy || offset === 0} onClick={() => void search(Math.max(0, offset - 25))}>{t("previous")}</button><button className={control} disabled={busy || data.nextOffset === null} onClick={() => void search(data.nextOffset ?? 0)}>{t("next")}</button></div>}
  </section>;
}
