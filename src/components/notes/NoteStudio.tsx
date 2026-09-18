"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { captureTaskSchema } from "@/lib/notes/intake.shared";
import { generationBody, GENERATION_KINDS, type GenerationKind, type GenerationResult, type GenerationReview } from "@/lib/notes/generation.shared";
import { TaskStateFields } from "./TaskStateFields";
import { useNotesFetch, useNotesNavigation, useNotesDirtyState } from "./NotesNavigation";

export function NoteStudio({ canCreate, onChanged }: { canCreate: boolean; onChanged: () => Promise<void> }) {
  const t = useTranslations("notes.studio"), n = useTranslations("notes"), locale = useLocale();
  const fetchNotes = useNotesFetch();
  const navigation = useNotesNavigation(), params = navigation.params;
  const kind = (canCreate ? params.get("studioKind") ?? "synthesize" : "ask") as GenerationKind;
  const includeSources = params.get("studioSources") === "1", thread = params.get("thread"), jobId = params.get("job");
  const setKind = (value: GenerationKind) => navigation.change({ studioKind: value });
  const setIncludeSources = (value: boolean) => navigation.change({ studioSources: value ? "1" : "0" });
  const setThread = (value: string | null) => navigation.change({ thread: value });
  const [question, setQuestion] = useState("");
  const submittedQuestion = useRef("");
  const [resources, setResources] = useState<Array<{ resourceId: string; title: string }>>([]), [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; kind: GenerationKind }>>([]), [loadedJob, setJob] = useState<GenerationResult | null>(null);
  const [review, setReview] = useState<GenerationReview | null>(null), [dirty, setDirty] = useState(false);
  const [working, setBusy] = useState(false), [jobLoading, setJobLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const job = loadedJob?.id === jobId ? loadedJob : null, busy = working || jobLoading;
  const currentId = useRef<string | null>(null), controller = useRef<AbortController | null>(null), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const api = useCallback(async <T,>(url: string, body?: unknown, method = "POST"): Promise<T> => {
    const response = await fetchNotes(url, { cache: "no-store", ...(body !== undefined ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!alive.current) throw new DOMException("Aborted", "AbortError");
    if (!response.ok) throw new Error(result.error ?? n("loadFailed"));
    return result;
  }, [n, fetchNotes]);
  const load = useCallback(async (id: string, initialize = false) => {
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    try {
      const response = await fetchNotes(`/api/notes/generation/${id}`, { cache: "no-store", signal: active.signal });
      const data: GenerationResult = await response.json();
      if (active.signal.aborted || currentId.current !== id) return;
      if (!response.ok) { setJob(null); setReview(null); throw new Error(n("loadFailed")); }
      setJob(data);
      if (data.state === "invalidated") { setReview(null); setDirty(false); }
      else if (data.state === "ready" && initialize) { setReview(data.review ?? { title: data.parts[0]?.title ?? "", body: generationBody(data.parts), actions: data.parts.flatMap((part, p) => part.actions.map((action, a) => captureTaskSchema.parse({ ...action, actionKey: `${p}:${a}`, included: false }))) }); setDirty(false); }
    } catch (failure) { if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : n("loadFailed")); }
    finally { if (!active.signal.aborted) setJobLoading(false); }
  }, [n, fetchNotes]);
  useEffect(() => {
    currentId.current = jobId;
    const timer = window.setTimeout(() => {
      setReview(null); setDirty(false); setError(null); setJobLoading(!!jobId);
      if (jobId) void load(jobId, true); else setJob(null);
    }, 0);
    return () => { window.clearTimeout(timer); controller.current?.abort(); };
  }, [jobId, load]);
  async function saveReview() {
    if (!job || !review) return;
    const saved = await api<GenerationResult>(`/api/notes/generation/${job.id}/review`, { ...review, expectedVersion: job.version, requestId: crypto.randomUUID() });
    setJob(saved); setDirty(false);
  }
  useNotesDirtyState({ dirty, busy, keys: ["pathname", "view", "job"], keep: saveReview });
  useNotesDirtyState(() => ({ dirty: !!question.trim() && question !== submittedQuestion.current, keys: ["pathname", "view"], discard: () => setQuestion("") }));
  const refresh = useCallback(async () => { const [catalog, recent] = await Promise.all([api<{ resources: typeof resources }>("/api/notes/knowledge/resources"), api<typeof history>("/api/notes/generation")]); setResources(catalog.resources); setHistory(recent); }, [api]);
  useEffect(() => {
    let active = true;
    Promise.all([api<{ resources: typeof resources }>("/api/notes/knowledge/resources"), api<typeof history>("/api/notes/generation")]).then(([catalog, recent]) => { if (active) { setResources(catalog.resources); setHistory(recent); } }).catch(() => { if (active) setError(n("loadFailed")); });
    return () => { active = false; currentId.current = null; controller.current?.abort(); };
  }, [api, n]);
  useEffect(() => {
    const check = () => { if (currentId.current && !jobLoading) void load(currentId.current); };
    window.addEventListener("focus", check); const timer = window.setInterval(check, 15_000);
    return () => { window.removeEventListener("focus", check); window.clearInterval(timer); };
  }, [load, jobLoading]);
  useEffect(() => { if (!dirty) return; const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent); }, [dirty]);
  async function action(run: () => Promise<void>) { setBusy(true); setError(null); try { await run(); } catch (failure) { setError(failure instanceof Error ? failure.message : n("saveFailed")); } finally { setBusy(false); } }
  const choose = async (id: string) => { if (id === jobId) await load(id, true); else { setJobLoading(true); navigation.change({ job: id }, false, true); } };
  const cls = "rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm disabled:opacity-40";
  return <section data-testid="notes-studio" className="min-w-0 flex-1 space-y-5 p-5 sm:p-7"><h2 className="text-xl font-semibold">{t("title")}</h2><p className="text-sm text-hq-fg-muted">{t("hint")}</p>
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"><aside className="space-y-2"><h3 className="text-sm font-semibold">{t("history")}</h3>{history.map((item) => <button disabled={busy || dirty} className={`${cls} block w-full text-left`} key={item.id} onClick={() => void action(() => choose(item.id))}>{t(`kinds.${item.kind}`)} · {item.id.slice(-4)}</button>)}</aside><div className="space-y-4">
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (busy || dirty || kind !== "ask" && !selected.length || kind === "ask" && !question.trim()) return; void action(async () => { const result = await api<{ jobId: string }>("/api/notes/generation", { requestId: crypto.randomUUID(), kind, locale, resourceIds: selected, question, threadId: kind === "ask" ? thread : null, includeSources }); submittedQuestion.current = question; await choose(result.jobId); await refresh(); }); }}>
    <label className="block text-sm">{t("kind")}<select className={`${cls} ml-3`} value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as GenerationKind)}>{GENERATION_KINDS.filter((value) => canCreate || value === "ask").map((value) => <option key={value} value={value}>{t(`kinds.${value}`)}</option>)}</select></label>
    {kind !== "ask" ? <fieldset className="max-h-48 space-y-2 overflow-y-auto"><legend>{t("resources")}</legend>{resources.map((resource) => <label key={resource.resourceId} className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || !selected.includes(resource.resourceId) && selected.length >= 3} checked={selected.includes(resource.resourceId)} onChange={(event) => setSelected((values) => event.target.checked ? [...values, resource.resourceId] : values.filter((value) => value !== resource.resourceId))} />{resource.title}</label>)}</fieldset> : <><label className="flex gap-2 text-xs"><input type="checkbox" checked={includeSources} onChange={(event) => setIncludeSources(event.target.checked)} />{n("knowledge.includeSources")}</label><p className="text-xs text-hq-fg-muted">{t("threadHint")}</p>{thread && <button type="button" className={cls} onClick={() => setThread(null)}>{t("newThread")}</button>}</>}
    <label className="block text-sm">{t("question")}<textarea className={`${cls} mt-2 w-full`} value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} /></label>
    <button type="submit" className={cls} disabled={busy || dirty || kind !== "ask" && !selected.length || kind === "ask" && !question.trim()}>{t("start")}</button>
    </form>
    {job && <section className="space-y-3 rounded-xl border border-hq-border p-4"><p role="status">{t(`states.${job.state}`)}</p><p className="text-xs">{n("knowledge.progress", { done: job.cursor.toLocaleString(locale), total: job.total.toLocaleString(locale) })}</p><div className="flex flex-wrap gap-2">{["pending", "running"].includes(job.state) && <button className={cls} disabled={busy} onClick={() => void action(async () => { await api(`/api/notes/generation/${job.id}/process`, {}); await load(job.id, true); })}>{t("process")}</button>}{["pending", "running", "ready"].includes(job.state) && <button className={cls} disabled={busy || dirty} onClick={() => void action(async () => { await api(`/api/notes/generation/${job.id}`, { command: "cancel", expectedVersion: job.version }, "PATCH"); await load(job.id); setReview(null); })}>{n("imports.cancel")}</button>}{["failed", "cancelled"].includes(job.state) && !job.threadId && <button className={cls} disabled={busy} onClick={() => void action(async () => { await api(`/api/notes/generation/${job.id}`, { command: "retry", expectedVersion: job.version }, "PATCH"); await load(job.id); })}>{n("imports.retry")}</button>}{job.threadId && job.state === "ready" && <button className={cls} disabled={busy || dirty} onClick={() => setThread(job.threadId)}>{t("continueThread")}</button>}{job.noteId && <Link className={cls} href={`/notes/${job.noteId}`}>{n("documents.openInNotes")}</Link>}</div>
    {job.state === "ready" && !review && <button className={cls} onClick={() => void load(job.id, true)}>{n("knowledge.reload")}</button>}
    {review && job.state === "ready" && <><label className="block text-sm">{n("fields.title")}<input className={`${cls} w-full`} value={review.title} maxLength={160} disabled={!canCreate} onChange={(event) => { setReview({ ...review, title: event.target.value }); setDirty(true); }} /></label><label className="block text-sm">{n("bodyLabel")}<textarea className={`${cls} w-full`} rows={12} value={review.body} maxLength={100000} readOnly={!canCreate} onChange={(event) => { setReview({ ...review, body: event.target.value }); setDirty(true); }} /></label>
    {canCreate && review.actions.map((item, index) => <div key={item.actionKey} className="space-y-2 rounded border border-hq-border p-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={item.included} disabled={!item.included && review.actions.filter((action) => action.included).length >= 10} onChange={(event) => { setReview({ ...review, actions: review.actions.map((action, at) => at === index ? { ...action, included: event.target.checked } : action) }); setDirty(true); }} />{n("intake.includeTask")}</label><input className={`${cls} w-full`} value={item.title} onChange={(event) => { setReview({ ...review, actions: review.actions.map((action, at) => at === index ? { ...action, title: event.target.value } : action) }); setDirty(true); }} /><TaskStateFields status={item.status} priority={item.priority} onStatus={(status) => { setReview({ ...review, actions: review.actions.map((action, at) => at === index ? { ...action, status } : action) }); setDirty(true); }} onPriority={(priority) => { setReview({ ...review, actions: review.actions.map((action, at) => at === index ? { ...action, priority } : action) }); setDirty(true); }} /><p className="text-xs text-hq-fg-muted">{item.evidence}</p></div>)}
    {canCreate && <><p className="text-xs text-hq-fg-muted">{t("unsaved")}</p><div className="flex gap-2"><button className={cls} disabled={busy || !dirty} onClick={() => void action(saveReview)}>{t("saveReview")}</button><button className={cls} disabled={busy || !review.body.trim() || !review.title.trim()} onClick={() => void action(async () => { await api(`/api/notes/generation/${job.id}`, { ...review, expectedVersion: job.version, requestId: crypto.randomUUID() }); setDirty(false); setReview(null); await load(job.id); await onChanged(); })}>{t("accept")}</button></div></>}
    <details><summary>{t("citations")}</summary>{job.parts.flatMap((part) => part.sections.flatMap((section) => section.citations)).map((citation, index) => <blockquote key={index} className="my-2 border-l-2 border-hq-border pl-3 text-sm">[{index + 1}] {citation.quote}</blockquote>)}</details></>}
    </section>}{error && <p role="alert" className="text-sm text-hq-danger">{error}</p>}</div></div></section>;
}
