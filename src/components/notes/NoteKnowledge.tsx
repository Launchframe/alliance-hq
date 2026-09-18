"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { useNotesFetch, useNotesNavigation } from "./NotesNavigation";
import { workspaceOffset } from "@/lib/notes/workspace.shared";
import type { KnowledgeCommand, KnowledgeEvidence, KnowledgeStatus } from "@/lib/notes/knowledge.shared";

type Resource = Pick<KnowledgeStatus, "resourceId" | "kind" | "entityId" | "title" | "isOwner">;
type Catalog = { resources: Resource[]; nextCursor: string | null; previousCursor: string | null };
export function NoteKnowledge({ onChanged }: { onChanged: () => Promise<void> }) {
  const t = useTranslations("notes.knowledge"), notesT = useTranslations("notes"), locale = useLocale();
  const fetchNotes = useNotesFetch();
  const navigation = useNotesNavigation(), params = navigation.params;
  const owned = params.get("knowledgeOwned") === "1", offset = workspaceOffset(params.get("knowledgeOffset"), 50);
  const selected = params.get("knowledge"), query = params.get("knowledgeQuery") ?? "", includeSources = params.get("knowledgeSources") === "1";
  const cursor = params.get("knowledgeCursor");
  const setCursor = (value: string | null) => navigation.change({ knowledgeCursor: value, knowledgeOffset: null });
  const setSelected = (value: string) => navigation.change({ knowledge: value });
  const setQuery = (value: string) => navigation.change({ knowledgeQuery: value }, true);
  const setIncludeSources = (value: boolean) => navigation.change({ knowledgeSources: value ? "1" : "0" });
  const [catalog, setCatalog] = useState<Catalog>({ resources: [], nextCursor: null, previousCursor: null });
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const catalogErrorAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { if (catalogError) catalogErrorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [catalogError]);
  const [evidenceKey, setEvidenceKey] = useState("");
  const [pendingConsent, setPendingConsent] = useState<boolean | null>(null);
  const [evidence, setEvidence] = useState<KnowledgeEvidence[] | null>(null);
  const [busy, setBusy] = useState(false), [queryBusy, setQueryBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const selection = useRef<string | null>(null), current = useRef<KnowledgeStatus | null>(null), frozen = useRef(false);
  const queryRequest = useRef<AbortController | null>(null);
  const epoch = useRef(0), catalogRead = useRef(0);
  useEffect(() => () => { epoch.current++; selection.current = null; current.current = null; queryRequest.current?.abort(); }, []);
  const clearEvidence = useCallback(() => { queryRequest.current?.abort(); setQueryBusy(false); setEvidence(null); }, []);
  const api = useCallback(async <T,>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const generation = epoch.current;
    const response = await fetchNotes(url, { cache: "no-store", signal, ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => null);
    if (generation !== epoch.current) throw new DOMException("", "AbortError");
    if (!response.ok || !data) {
      if ([401, 403, 404].includes(response.status)) { epoch.current++; selection.current = null; current.current = null; setCatalog({ resources: [], nextCursor: null, previousCursor: null }); setStatus(null); clearEvidence(); }
      throw new Error(data?.code === "rate_limited" ? t("limits") : data?.error ?? notesT("loadFailed"));
    }
    return data;
  }, [clearEvidence, notesT, t, fetchNotes]);
  const refreshCatalog = useCallback(async (signal?: AbortSignal) => {
    const number = ++catalogRead.current;
    try {
      const query = new URLSearchParams({ format: "page", owned: String(owned), offset: String(cursor ? 0 : offset), ...(cursor ? { cursor } : {}) });
      const data = await api<{ items: Resource[]; nextCursor: string | null; previousCursor: string | null }>(`/api/notes/knowledge/resources?${query}`, undefined, signal);
      if (!signal?.aborted && number === catalogRead.current) { setCatalog({ resources: data.items, nextCursor: data.nextCursor, previousCursor: data.previousCursor }); setCatalogError(null); }
    } catch (failure) { if (!signal?.aborted && number === catalogRead.current) setCatalogError(failure instanceof Error ? failure.message : notesT("loadFailed")); }
  }, [api, owned, offset, cursor, notesT]);
  const loadStatus = useCallback(async (id: string, manual = false, signal?: AbortSignal) => {
    try {
      const next = await api<KnowledgeStatus>(`/api/notes/knowledge/resources/${encodeURIComponent(id)}`, undefined, signal);
      if (signal?.aborted || selection.current !== id) return;
      if (!manual && current.current && current.current.contentVersion !== next.contentVersion) { frozen.current = true; setStatus(null); clearEvidence(); setError(t("changed")); return; }
      if (manual || !frozen.current) { current.current = next; setStatus(next); }
    } catch (failure) { if (!signal?.aborted) { setStatus(null); setError(failure instanceof Error ? failure.message : notesT("loadFailed")); } }
  }, [api, clearEvidence, notesT, t]);
  useEffect(() => { const controller = new AbortController(); void refreshCatalog(controller.signal); return () => controller.abort(); }, [refreshCatalog]);
  useEffect(() => {
    selection.current = selected; current.current = null; frozen.current = false; setStatus(null); setError(null);
    const controller = new AbortController();
    if (selected) void loadStatus(selected, true, controller.signal);
    return () => controller.abort();
  }, [loadStatus, selected]);
  useEffect(() => {
    const refresh = () => { clearEvidence(); void refreshCatalog(); if (selection.current && !frozen.current) void loadStatus(selection.current); };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); queryRequest.current?.abort(); };
  }, [clearEvidence, loadStatus, refreshCatalog]);
  const indexState = status?.indexState;
  useEffect(() => {
    if (!selected || !indexState || !["pending", "running"].includes(indexState)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => { if (!frozen.current) void loadStatus(selected, false, controller.signal); }, 2_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [loadStatus, selected, indexState]);
  async function command(command: KnowledgeCommand["command"]) {
    if (!selected || !status || busy) return;
    const id = selected;
    setBusy(true); setError(null); clearEvidence();
    if (command === "allow_ai" || command === "deny_ai") setPendingConsent(command === "allow_ai");
    try {
      const next = await api<KnowledgeStatus>(`/api/notes/knowledge/resources/${encodeURIComponent(id)}`, { command, requestId: crypto.randomUUID(), expectedVersion: status.version, expectedContentVersion: status.contentVersion });
      if (selection.current === id) { current.current = next; setStatus(next); }
      await Promise.all([refreshCatalog(), onChanged()]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : notesT("saveFailed")); }
    finally { setBusy(false); setPendingConsent(null); }
  }
  async function process() {
    if (!selected || busy) return;
    setBusy(true); setError(null);
    try { await api(`/api/notes/knowledge/resources/${encodeURIComponent(selected)}/process`, {}); await loadStatus(selected); }
    catch (failure) { setError(failure instanceof Error ? failure.message : notesT("saveFailed")); }
    finally { setBusy(false); }
  }
  async function search(mode: "keyword" | "semantic") {
    clearEvidence(); setQueryBusy(true); setError(null);
    const controller = new AbortController(); queryRequest.current = controller;
    try {
      const data = await api<{ evidence: KnowledgeEvidence[] }>("/api/notes/knowledge/search", { q: query, mode, includeSources }, controller.signal);
      if (!controller.signal.aborted) { setEvidence(data.evidence); setEvidenceKey(JSON.stringify([query, includeSources])); }
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : notesT("loadFailed")); }
    finally { if (!controller.signal.aborted) setQueryBusy(false); }
  }
  const visibleEvidence = evidenceKey === JSON.stringify([query, includeSources]) ? evidence : null;
  const button = "rounded-lg border border-hq-border px-3 py-2 text-xs hover:bg-hq-surface disabled:opacity-40";
  return <section data-testid="notes-knowledge" className="min-w-0 flex-1 space-y-5 p-5 sm:p-7">
    <h2 className="text-xl font-semibold">{t("title")}</h2><p className="text-sm text-hq-fg-muted">{t("guidance")}</p>
    {error && <p role="alert" className="text-sm text-hq-danger">{error}</p>}
    {catalogError && <div ref={catalogErrorAnchor} className="space-y-2"><p role="alert" className="text-sm text-hq-danger">{catalogError}</p><button type="button" className={button} onClick={() => { setCatalogError(null); void refreshCatalog(); }}>{notesT("workspace.retryLoading")}</button></div>}
    <div className="flex gap-2">{[true, false].map((value) => <button key={String(value)} disabled={busy} className={`${button} ${owned === value ? "bg-hq-accent/10 text-hq-accent" : ""}`} onClick={() => { navigation.change({ knowledgeOwned: value ? "1" : "0", knowledgeOffset: null, knowledgeCursor: null, knowledge: null }); clearEvidence(); }}>{t(value ? "owned" : "library")}</button>)}</div>
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]"><aside className="space-y-2">{catalog.resources.map((resource) => <div key={resource.resourceId} className="rounded-lg border border-hq-border p-3"><p className="text-xs text-hq-fg-muted">{notesT(`searchWorkspace.${resource.kind}`)}</p>{resource.isOwner ? <button disabled={busy} onClick={() => setSelected(resource.resourceId)} className="mt-1 text-left text-sm font-medium text-hq-accent">{resource.title || notesT("editor.untitled")}</button> : resource.kind === "note" || resource.kind === "task" ? <Link href={resource.kind === "note" ? `/notes/${resource.entityId}` : `/notes?view=tasks&task=${encodeURIComponent(resource.entityId)}`} className="mt-1 block text-sm text-hq-accent">{resource.title}</Link> : <p className="text-sm">{resource.title}</p>}</div>)}{!catalog.resources.length && <p className="text-sm text-hq-fg-muted">{t("empty")}</p>}<div className="flex gap-2"><button type="button" className={button} disabled={!catalog.previousCursor || busy} onClick={() => setCursor(catalog.previousCursor)}>{t("previous")}</button><button type="button" className={button} disabled={!catalog.nextCursor || busy} onClick={() => setCursor(catalog.nextCursor)}>{t("next")}</button></div></aside>
      <div className="space-y-4">{status && status.resourceId === selected ? <section className="space-y-3 rounded-xl border border-hq-border p-4"><h3 className="font-semibold">{status.title}</h3><p className="text-xs text-hq-fg-muted">{t("contentVersion", { version: status.contentVersion.toLocaleString(locale) })} · {t(status.approved ? "approved" : "unapproved")}</p>{status.href && <Link href={status.href} className="block text-sm text-hq-accent">{t("open")}</Link>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !status.canEnable || status.approved} onClick={() => void command("approve")}>{t("approve")}</button><button className={button} disabled={busy || !status.approved} onClick={() => void command("unapprove")}>{t("unapprove")}</button></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={pendingConsent ?? status.aiAllowed} disabled={busy || !status.aiAllowed && !status.canEnable} onChange={(event) => void command(event.target.checked ? "allow_ai" : "deny_ai")} />{t("allowAi")}</label><p className="text-xs leading-5 text-hq-fg-muted">{t("consent")}</p>
        <p className="text-sm font-medium" role="status">{t(`states.${status.indexState}`)}</p>{status.totalChunks !== null ? <p className="text-xs">{t("progress", { done: status.completedChunks.toLocaleString(locale), total: status.totalChunks.toLocaleString(locale) })}</p> : status.indexState === "pending" || status.indexState === "running" ? <p className="text-xs">{t("pendingTotal")}</p> : null}
        {!status.configured && <p className="text-xs text-hq-fg-muted">{t("unavailable")}</p>}{status.indexState === "failed" && <p role="alert" className="text-xs text-hq-danger">{t("failed")}</p>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !status.canEnable || !status.configured || !status.approved || !status.aiAllowed || ["pending", "running", "completed"].includes(status.indexState)} onClick={() => void command(["failed", "cancelled"].includes(status.indexState) ? "retry" : "index")}>{t(["failed", "cancelled"].includes(status.indexState) ? "retry" : "index")}</button>{["pending", "running"].includes(status.indexState) && <><button className={button} disabled={busy || !status.canEnable} onClick={() => void process()}>{t("process")}</button><button className={button} disabled={busy} onClick={() => void command("cancel")}>{t("cancel")}</button></>}</div><p className="text-xs text-hq-fg-muted">{t("queuedHint")}</p><p className="text-xs text-hq-fg-muted">{t("limits")}</p>
      </section> : <p className="text-sm text-hq-fg-muted">{t("select")}</p>}{selected && <button className={button} disabled={busy} onClick={() => { frozen.current = false; setError(null); void loadStatus(selected, true); }}>{t("reload")}</button>}</div>
    </div>
    <form className="space-y-3 border-t border-hq-border pt-5" onSubmit={(event) => { preventDefaultFormSubmit(event); void search("keyword"); }}><label className="block text-sm">{notesT("searchWorkspace.query")}<input required maxLength={200} enterKeyHint="send" value={query} onChange={(event) => { clearEvidence(); setQuery(event.target.value); }} className="mt-2 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2" /></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeSources} onChange={(event) => { clearEvidence(); setIncludeSources(event.target.checked); }} />{t("includeSources")}</label><p className="text-xs text-hq-fg-muted">{t("semanticHint")}</p><div className="flex gap-2"><button className={button} disabled={queryBusy || !query.trim()}>{queryBusy ? t("working") : t("keyword")}</button><button type="button" className={button} disabled={queryBusy || !query.trim()} onClick={() => void search("semantic")}>{t("semantic")}</button></div></form>
    {visibleEvidence && !visibleEvidence.length && <p className="text-sm text-hq-fg-muted">{t("noEvidence")}</p>}{visibleEvidence?.map((item) => <article key={item.id} className="rounded-lg border border-hq-border p-4"><p className="mb-2 text-xs text-hq-fg-muted">{notesT(`searchWorkspace.${item.kind}`)}</p><p className="whitespace-pre-wrap break-words text-sm">{item.text}</p></article>)}
  </section>;
}
