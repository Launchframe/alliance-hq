"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Dialog } from "@/components/ui/dialog";
import { useNotesDirtyState, useNotesFetch, useNotesNavigation } from "./NotesNavigation";
import { workspaceOffset } from "@/lib/notes/workspace.shared";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import { HISTORY_IMPORT_KINDS, HISTORY_MESSAGE_LENGTH, HISTORY_TEXT_BYTES, historyInitSchema, type HistoryImportDetail, type HistoryImportKind, type HistoryImportListItem, type HistoryImportPage, type HistoryReviewRow } from "@/lib/notes/imports.shared";

class ImportError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const control = "rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm disabled:opacity-50";
function utcDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

export function NoteHistoryImports({ canCreate, focusId, onOpen }: { canCreate: boolean; focusId: string | null; onOpen: (id: string | null) => void }) {
  const t = useTranslations("notes.imports");
  const locale = useLocale();
  const fetchNotes = useNotesFetch(), navigation = useNotesNavigation();
  const urlCursor = navigation.params.get("importCursor");
  const offset = workspaceOffset(navigation.params.get("messageOffset"), 50);
  const setOffset = (value: number) => navigation.change({ messageOffset: String(value) }, false, true);
  const [list, setList] = useState<HistoryImportListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const listCursor = useRef<string | null>(null);
  const listReadNumber = useRef(0);
  const listNavigating = useRef(false);
  const listRefreshPending = useRef(false);
  const [scope, setScope] = useState("");
  const [detail, setDetail] = useState<HistoryImportDetail | null>(null);
  const [edits, setEdits] = useState<HistoryReviewRow[]>([]);
  const [kind, setKind] = useState<HistoryImportKind>("text");
  const [title, setTitle] = useState("");
  const [paste, setPaste] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const alive = useRef(false);
  const lifetime = useRef(new AbortController());
  const revision = useRef(0);
  const selection = useRef(focusId);
  selection.current = focusId;
  const readNumber = useRef(0);
  const dirty = useRef(false);
  const current = useRef<HistoryImportDetail | null>(null);
  const processing = useRef(false);
  const errorAnchor = useRef<HTMLDivElement>(null);
  const listErrorAnchor = useRef<HTMLDivElement>(null);
  const receipt = useRef({ hash: "", id: "" });
  const scopeRef = useRef("");
  useNotesDirtyState(() => ({
    dirty: dirty.current || !focusId && !!(paste || title || files.length), keys: ["pathname", "view", "import", "messageOffset"],
    busy: busy && !!focusId && detail?.state === "review",
    discard: () => {
      revision.current++; dirty.current = false; setEdits(current.current?.messages ?? []); setTitle(""); setPaste(""); setFiles([]);
      if (busy) { lifetime.current.abort(); lifetime.current = new AbortController(); setBusy(false); }
    },
  }));
  const applyScope = useCallback((next: string) => {
    if (scopeRef.current && scopeRef.current !== next) {
      revision.current++; listCursor.current = null; setPreviousCursor(null); setNextCursor(null); setList([]); setDetail(null);
      setFiles([]); setPaste(""); setTitle(""); setEdits([]); setDiscardAction(null); dirty.current = false; current.current = null;
    }
    scopeRef.current = next; setScope(next);
  }, []);
  useEffect(() => { alive.current = true; const controller = new AbortController(); lifetime.current = controller; return () => { alive.current = false; controller.abort(); lifetime.current.abort(); }; }, []);
  const fail = useCallback((failure: unknown, listFailure = false) => {
    if (!alive.current) return;
    if (failure instanceof ImportError && [401, 403, 404].includes(failure.status)) { applyScope(""); setList([]); setDetail(null); current.current = null; setEdits([]); setError(null); setListError(null); dirty.current = false; }
    (listFailure ? setListError : setError)(failure instanceof ImportError ? failure.message : t("error"));
    if (!listFailure) requestAnimationFrame(() => errorAnchor.current?.scrollIntoView({ block: "nearest" }));
  }, [t, applyScope]);
  useEffect(() => { if (listError) listErrorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [listError]);
  const api = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetchNotes(url, { cache: "no-store", signal: lifetime.current.signal, ...init });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new ImportError(body?.error ?? t("error"), response.status);
    return body;
  }, [t, fetchNotes]);
  const loadList = useCallback(async (cursor = urlCursor) => {
    const generation = revision.current;
    const number = ++listReadNumber.current;
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
    const body = await api<HistoryImportPage>(`/api/notes/imports${query}`).catch((failure) => { if (generation === revision.current && number === listReadNumber.current) throw failure; return null; });
    if (!body || !alive.current || selection.current || generation !== revision.current || number !== listReadNumber.current) return false;
    const changedScope = !!scopeRef.current && scopeRef.current !== body.scope;
    applyScope(body.scope); listCursor.current = cursor; setList(body.imports); setNextCursor(body.nextCursor); setListError(null);
    setPreviousCursor(body.previousCursor);
    return !changedScope;
  }, [api, applyScope, urlCursor]);
  const load = useCallback(async (id: string, page: number, reset = false) => {
    if (id !== selection.current) return;
    const generation = revision.current;
    const number = ++readNumber.current;
    const body = await api<{ import: HistoryImportDetail }>(`/api/notes/imports/${id}?offset=${page}`).catch((failure) => { if (generation === revision.current && number === readNumber.current) throw failure; return null; });
    if (!body || !alive.current || generation !== revision.current || id !== selection.current || number !== readNumber.current) return;
    applyScope(body.import.scope);
    if (dirty.current && !reset) { if (body.import.version !== current.current?.version) setError(t("changed")); return; }
    current.current = body.import; setDetail(body.import); setEdits(body.import.messages); dirty.current = false;
    return true;
  }, [api, t, applyScope]);
  useEffect(() => {
    revision.current++; current.current = null; dirty.current = false; setDetail(null); setEdits([]);
    if (focusId) void load(focusId, offset).catch(fail);
    else void loadList().catch((failure) => fail(failure, true));
  }, [focusId, offset, load, loadList, fail]);
  useEffect(() => {
    const refresh = () => {
      if (focusId) void load(focusId, offset).catch(fail);
      else if (listNavigating.current) listRefreshPending.current = true;
      else void loadList().catch((failure) => fail(failure, true));
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [focusId, offset, load, loadList, fail]);
  const processingState = detail?.state;
  useEffect(() => {
    if (!focusId || !processingState || !["queued", "processing"].includes(processingState)) return;
    let disposed = false;
    const tick = async () => {
      if (processing.current) return;
      processing.current = true;
      try { if (canCreate) await api(`/api/notes/imports/${focusId}/process`, { method: "POST" }); if (!disposed) await load(focusId, offset); }
      catch (failure) { if (!disposed) fail(failure); }
      finally { processing.current = false; }
    };
    const start = window.setTimeout(() => { void tick(); }, 200);
    const timer = window.setInterval(() => { void tick(); }, 4_000);
    return () => { disposed = true; window.clearTimeout(start); window.clearInterval(timer); };
  }, [focusId, processingState, canCreate, offset, api, load, fail]);
  function payload(value: object, resourceId = focusId ?? "new") {
    const hash = JSON.stringify([scope, resourceId, value]);
    if (receipt.current.hash !== hash) receipt.current = { hash, id: crypto.randomUUID() };
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, requestId: receipt.current.id }) };
  }
  async function run(work: () => Promise<unknown>, listAction = false) {
    if (busy || listNavigating.current) return;
    if (listAction) listNavigating.current = true;
    setBusy(true); setError(null); setListError(null);
    try { await work(); } catch (failure) { fail(failure, listAction); }
    finally {
      const refresh = listAction && listRefreshPending.current;
      if (listAction) { listNavigating.current = false; listRefreshPending.current = false; }
      if (alive.current) {
        setBusy(false);
        if (refresh && !selection.current) void loadList(listCursor.current).catch((failure) => fail(failure, true));
      }
    }
  }
  async function upload(existing?: HistoryImportDetail) {
    const generation = revision.current;
    let id = existing?.id;
    try {
      const format = existing?.kind ?? kind;
      const selected = files.length ? files : format !== "screenshots" && paste.trim() ? [new File([paste], format === "discord_json" ? "history.json" : format === "markdown" ? "history.md" : "history.txt", { type: format === "discord_json" ? "application/json" : format === "markdown" ? "text/markdown" : "text/plain" })] : [];
      const checked = historyInitSchema.safeParse({ expectedScope: scope, requestId: crypto.randomUUID(), title: existing?.title ?? title, kind: format, locale, files: selected.map((file) => ({ name: file.name, size: file.size, contentType: format === "screenshots" ? file.type : format === "discord_json" ? "application/json" : format === "markdown" ? "text/markdown" : "text/plain", sha256: "0".repeat(64) })) });
      if (!checked.success) throw new ImportError(t("invalid"), 400);
      const descriptors: typeof checked.data.files = [];
      for (let index = 0; index < selected.length; index++) {
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await selected[index].arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
        descriptors.push({ ...checked.data.files[index], sha256 });
      }
      if (!id) id = (await api<{ importId: string }>("/api/notes/imports", payload({ ...checked.data, files: descriptors }))).importId;
      const snapshot = (await api<{ import: HistoryImportDetail }>(`/api/notes/imports/${id}`)).import;
      if (snapshot.state === "uploading") {
        if (snapshot.files.length !== selected.length || snapshot.files.some((file, index) => file.sha256 !== descriptors[index].sha256)) throw new ImportError(t("invalid"), 400);
        for (let index = 0; index < snapshot.files.length; index++) {
          const asset = snapshot.files[index];
          if (asset.sealed) continue;
          const path = `/api/notes/imports/${id}/assets/${asset.id}`;
          const target = await api<{ url: string; contentType: string }>(path);
          const response = await fetchNotes(target.url, { method: "PUT", body: selected[index], headers: { "Content-Type": target.contentType }, credentials: target.url.startsWith("/") ? "same-origin" : "omit", signal: lifetime.current.signal });
          if (!response.ok) { const failure = target.url.startsWith("/") ? await response.json().catch(() => null) : null; throw new ImportError(failure?.error ?? t("error"), response.status); }
          await api(path, { method: "POST" });
        }
        await api(`/api/notes/imports/${id}`, payload({ command: "finalize", expectedVersion: snapshot.version }, id));
      }
      if (!alive.current || generation !== revision.current) return;
      setFiles([]); setPaste(""); setTitle("");
      if (id === focusId) await load(id, 0, true); else onOpen(id);
    } catch (failure) { if (id && id !== focusId && alive.current && generation === revision.current) onOpen(id); throw failure; }
  }
  async function command(command: "commit" | "cancel" | "retry") {
    if (!detail) return;
    await api(`/api/notes/imports/${detail.id}`, payload({ command, expectedVersion: detail.version }));
    await load(detail.id, offset, true);
  }
  function confirmDiscard(action: () => void) { if (dirty.current) setDiscardAction(() => action); else action(); }
  function navigate(id: string | null) { confirmDiscard(() => { setError(null); onOpen(id); }); }
  async function page(next: number) {
    if (!detail) return;
    if (await load(detail.id, next, true)) setOffset(next);
  }
  const errorBox = error ? <p role="alert" className="text-sm text-hq-danger">{error}</p> : null;
  return <section className="min-w-0 flex-1 space-y-5 p-5 sm:p-7">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("title")}</h2>{focusId && <button className={control} disabled={busy} onClick={() => navigate(null)}>{t("back")}</button>}</header>
    <p className="max-w-3xl text-sm text-hq-fg-muted">{t("privacy")}</p>
    {!focusId && <>
      {canCreate && <form onSubmit={(event) => { preventDefaultFormSubmit(event); void run(() => upload()); }} className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4">
        <h3 className="font-medium">{t("new")}</h3><p className="text-xs text-hq-fg-muted">{t("limits")}</p>
        <label className="flex flex-col gap-1 text-sm">{t("sourceTitle")}<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className={control} /></label>
        <label className="flex flex-col gap-1 text-sm">{t("format")}<select aria-label={t("format")} value={kind} onChange={(event) => { setKind(event.target.value as HistoryImportKind); setFiles([]); }} className={control}>{HISTORY_IMPORT_KINDS.map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}</select></label>
        {kind === "discord_json" && <p className="text-xs text-hq-fg-muted">{t("jsonHint")}</p>}
        {kind !== "screenshots" && <label className="flex flex-col gap-1 text-sm">{t("paste")}<textarea aria-label={t("paste")} data-no-enter-submit rows={5} maxLength={HISTORY_TEXT_BYTES} value={paste} onChange={(event) => setPaste(event.target.value)} className={control} /></label>}
        <label className="flex flex-col gap-1 text-sm">{t("files")}<input key={kind} type="file" multiple={kind === "screenshots"} accept={kind === "screenshots" ? "image/png,image/jpeg,image/webp" : kind === "discord_json" ? ".json" : kind === "markdown" ? ".md,.markdown" : ".txt"} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
        <div ref={!focusId ? errorAnchor : undefined} className="space-y-2">{errorBox}<button className={control} disabled={busy || !scope || !title.trim() || !files.length && !paste.trim()}>{busy ? t("busy") : t("start")}</button></div>
      </form>}
      {!list.length ? <p className="text-sm text-hq-fg-muted">{t("empty")}</p> : <div className="grid gap-3 sm:grid-cols-2">{list.map((item) => <button key={item.id} onClick={() => navigate(item.id)} className="space-y-2 rounded-xl border border-hq-border bg-hq-canvas p-4 text-left"><p className="font-medium">{item.title}</p><p className="text-xs text-hq-fg-muted">{t(`states.${item.state}`)} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(item.updatedAt))}</p></button>)}</div>}
      {(previousCursor || nextCursor || listError) && <div ref={listErrorAnchor} className="space-y-2">
        {listError && <p role="alert" className="text-sm text-hq-danger">{listError}</p>}
        <div className="flex gap-2">
          <button className={control} disabled={busy || !previousCursor} onClick={() => void run(async () => { if (await loadList(previousCursor)) navigation.change({ importCursor: previousCursor }); }, true)}>{t("previous")}</button>
          <button className={control} disabled={busy || !nextCursor} onClick={() => void run(async () => { if (nextCursor && await loadList(nextCursor)) navigation.change({ importCursor: nextCursor }); }, true)}>{t("next")}</button>
        </div>
      </div>}
      {!canCreate && errorBox}
    </>}
    {focusId && !detail && <div ref={errorAnchor}>{errorBox ?? <p role="status">{t("busy")}</p>}</div>}
    {detail && <>
      <div className="space-y-2 rounded-xl border border-hq-border bg-hq-surface p-4"><h3 className="font-semibold">{detail.title}</h3><p role="status" className="text-sm">{t(`states.${detail.state}`)}</p><p className="text-xs text-hq-fg-muted">{t("fileProgress", { done: detail.cursor, total: detail.files.length })} · {t("progress", { reviewed: detail.reviewed, total: detail.total })}</p>{detail.errorCode && <p className="text-sm text-hq-danger">{t("processingError")}</p>}{detail.state === "committed" && <p className="text-sm text-hq-success">{t("saved")}</p>}</div>
      {detail.state === "uploading" && canCreate && <div className="space-y-3"><p className="text-sm">{t("resumeHint")}</p><label className="flex flex-col gap-2 text-sm">{t("files")}<input type="file" multiple={detail.kind === "screenshots"} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label><button className={control} disabled={busy || !files.length} onClick={() => void run(() => upload(detail))}>{t("resumeUpload")}</button></div>}
      {["review", "committed"].includes(detail.state) && <div className="space-y-4">{edits.map((row, index) => <fieldset key={row.id} disabled={busy || !canCreate || detail.state !== "review"} className="space-y-3 rounded-xl border border-hq-border p-4">
        <legend className="px-1 text-xs text-hq-fg-muted">{(row.position + 1).toLocaleString(locale)} · {row.reviewed ? t("reviewed") : t("unreviewed")}</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-xs">{t("sender")}<input aria-label={t("sender")} className={control} maxLength={160} placeholder={t("unknown")} value={row.sender ?? ""} onChange={(event) => { dirty.current = true; setEdits((rows) => rows.map((item, at) => at === index ? { ...item, sender: event.target.value || null } : item)); }} /></label>
          <label className="flex flex-col gap-1 text-xs">{t("date")}<input aria-label={t("date")} type="datetime-local" className={control} value={utcDatetimeLocal(row.sentAt)} onChange={(event) => { dirty.current = true; setEdits((rows) => rows.map((item, at) => at === index ? { ...item, sentAt: event.target.value ? `${event.target.value}:00.000Z` : null } : item)); }} /></label></div>
        <label className="flex flex-col gap-1 text-xs">{t("body")}<textarea aria-label={t("body")} data-no-enter-submit rows={4} maxLength={HISTORY_MESSAGE_LENGTH} className={control} value={row.body} onChange={(event) => { dirty.current = true; setEdits((rows) => rows.map((item, at) => at === index ? { ...item, body: event.target.value } : item)); }} /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={row.included} onChange={(event) => { dirty.current = true; setEdits((rows) => rows.map((item, at) => at === index ? { ...item, included: event.target.checked } : item)); }} />{t("include")}</label>
      </fieldset>)}
        <div className="flex flex-wrap gap-2"><button className={control} disabled={busy || offset === 0} onClick={() => confirmDiscard(() => void run(() => page(Math.max(0, offset - 50))))}>{t("previous")}</button><button className={control} disabled={busy || offset + 50 >= detail.total} onClick={() => confirmDiscard(() => void run(() => page(offset + 50)))}>{t("next")}</button><button className={control} disabled={busy} onClick={() => confirmDiscard(() => void run(() => load(detail.id, offset, true)))}>{t("reload")}</button></div>
      </div>}
      <div ref={focusId ? errorAnchor : undefined} className="space-y-3">{errorBox}{canCreate && <div className="flex flex-wrap gap-2">
        {detail.state === "review" && <><button className={control} disabled={busy || !edits.length} onClick={() => void run(async () => { await api(`/api/notes/imports/${detail.id}`, { ...payload({ expectedVersion: detail.version, edits: edits.map(({ id, sender, sentAt, body, included }) => ({ id, sender, sentAt, body, included })) }), method: "PATCH" }); await load(detail.id, offset, true); })}>{t("reviewPage")}</button><button className={`${control} bg-hq-accent text-white`} disabled={busy || dirty.current || detail.reviewed !== detail.total || !detail.total} onClick={() => void run(() => command("commit"))}>{t("commit")}</button></>}
        {["failed", "cancelled"].includes(detail.state) && <button className={control} disabled={busy} onClick={() => void run(() => command("retry"))}>{t("retry")}</button>}
        {!["committed", "cancelled"].includes(detail.state) && <button className={control} disabled={busy} onClick={() => confirmDiscard(() => void run(() => command("cancel")))}>{t("cancel")}</button>}
      </div>}</div>
    </>}
    <Dialog open={!!discardAction} onOpenChange={(open) => { if (!open) setDiscardAction(null); }} title={t("discard")} className="max-w-md">
      <div className="space-y-4 p-5"><p>{t("discard")}</p><div className="flex flex-wrap gap-2"><button autoFocus className={control} onClick={() => setDiscardAction(null)}>{t("keepReviewing")}</button><button className={control} onClick={() => { dirty.current = false; const action = discardAction; setDiscardAction(null); action?.(); }}>{t("discardChanges")}</button></div></div>
    </Dialog>
  </section>;
}
