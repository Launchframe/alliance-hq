"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { SnapshotAccessRevoked } from "@/lib/member-board/versioned-live";
import { useLocale, useTranslations } from "next-intl";
import { CheckSquare, Plus, Share2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatAccountDate } from "@/lib/timezone/format";
import { TASK_STATUSES, type NoteTask, type NoteTaskSummary, type TaskCreate, type TaskPatch } from "@/lib/notes/tasks.shared";
import type { NoteShareState } from "@/lib/notes/sharing.shared";
import { TaskStateFields } from "./TaskStateFields";
import { NoteTaskEditor } from "./NoteTaskEditor";
import { NoteShareDialog } from "./NoteShareDialog";
import { useOptionalNotesNavigation, useNotesFetch } from "./NotesNavigation";

type Snapshot = { tasks: NoteTaskSummary[]; people: NoteShareState["recipients"]; canCreate: boolean; principalId?: string; nextCursor?: string | null; previousCursor?: string | null; readVersion?: number; queryKey?: string };
type Modal = { kind: "edit" | "share"; task: NoteTask | null } | null;
export function NoteTasksPanel({ sourceNoteId, focusId, personalOnly = false, filterValue, onFilterChange }: { sourceNoteId?: string; focusId?: string; personalOnly?: boolean; filterValue?: string; onFilterChange?: (value: string) => void }) {
  const t = useTranslations("notes"), locale = useLocale();
  const navigation = useOptionalNotesNavigation(), fetchNotes = useNotesFetch();
  const focusName = sourceNoteId ? "noteTask" : "task", cursorName = sourceNoteId ? "noteTaskCursor" : "taskCursor";
  const [localFocus, setLocalFocus] = useState<string | null>(focusId ?? null), [localCursor, setLocalCursor] = useState<string | null>(null);
  const [localFilter, setLocalFilter] = useState("active"), [localLabel, setLocalLabel] = useState("");
  const focus = navigation ? focusId ?? navigation.params.get(focusName) : localFocus;
  const cursor = navigation ? navigation.params.get(cursorName) : localCursor;
  const filter = filterValue ?? localFilter, label = navigation && !sourceNoteId ? navigation.params.get("taskLabel") ?? "" : localLabel;
  const [data, setData] = useState<Snapshot>({ tasks: [], people: [], canCreate: false });
  const [errors, setErrors] = useState<Record<string, string>>({}), [pending, setPending] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null), [modalKind, setModalKind] = useState<"edit" | "share">("edit");
  const modalRef = useRef(modal), request = useRef<AbortController | null>(null), readVersion = useRef(0), errorAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { modalRef.current = modal; }, [modal]);
  const setCursor = (value: string | null) => { if (navigation) navigation.change({ [cursorName]: value }); else setLocalCursor(value); };
  const setFilter = (value: string) => { setLocalCursor(null); if (onFilterChange) onFilterChange(value); else { setLocalFilter(value); navigation?.change({ [cursorName]: null }); } };
  const setLabel = (value: string) => { if (navigation && !sourceNoteId) navigation.change({ taskLabel: value, taskCursor: null }); else { setLocalLabel(value); setCursor(null); } };
  const open = useCallback((task: NoteTaskSummary | null, kind: "edit" | "share" = "edit") => {
    setModalKind(kind);
    if (navigation) navigation.change({ [focusName]: task?.id ?? "new" }); else setLocalFocus(task?.id ?? "new");
  }, [navigation, focusName]);
  const close = () => { navigation?.change({ [focusName]: null }, true, true); setLocalFocus(null); setModal(null); };
  const lastFocus = useRef(focus);
  useEffect(() => navigation?.store.subscribe(() => {
    const next = new URL(navigation.store.getSnapshot().url, window.location.origin).searchParams.get(focusName);
    if (next !== lastFocus.current) { lastFocus.current = next; setModal(null); }
  }), [navigation?.store, focusName]);
  const hotkeys = useMemo(() => ({ "notes.newTask": () => { if (data.canCreate) open(null); } }), [data.canCreate, open]);
  useRegisterPageHotkeys(hotkeys, !modal);
  const query = new URLSearchParams({ format: "summary", status: filter, label, ...(sourceNoteId ? { sourceNoteId } : {}), ...(personalOnly ? { personalOnly: "1" } : {}), ...(cursor ? { cursor } : {}) });
  const endpoint = `/api/notes/tasks?${query}`;
  const read = useCallback(async (signal?: AbortSignal): Promise<Snapshot> => {
    request.current?.abort();
    const controller = new AbortController(), version = ++readVersion.current; request.current = controller;
    const response = await fetchNotes(endpoint, { cache: "no-store", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    const payload = await response.json();
    if (controller.signal.aborted || signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if ([401, 403, 404].includes(response.status)) throw new SnapshotAccessRevoked(payload.error ?? t("errors.forbidden"));
    if (!response.ok) throw new Error(payload.error ?? t("loadFailed"));
    return { ...payload, readVersion: version, queryKey: endpoint };
  }, [endpoint, t, fetchNotes]);
  const apply = useCallback(async (next: Snapshot, signal?: AbortSignal) => {
    if (next.readVersion !== readVersion.current || signal?.aborted) return;
    const previous = modalRef.current?.task;
    let allowed: NoteTaskSummary | NoteTask | null = previous ? next.tasks.find((task) => task.id === previous.id) ?? null : null;
    if (previous && !allowed) {
      const response = await fetchNotes(`/api/notes/tasks/${encodeURIComponent(previous.id)}`, { cache: "no-store", signal });
      const payload = await response.json();
      if (!response.ok && ![401, 403, 404].includes(response.status)) throw new Error(payload.error ?? t("loadFailed"));
      allowed = response.ok && (!sourceNoteId || payload.task?.source?.id === sourceNoteId) ? payload.task : null;
    }
    if (next.readVersion !== readVersion.current || signal?.aborted) return;
    setData(next); setErrors((current) => ({ ...current, list: "" }));
    if (previous) setModal((current) => {
      if (current?.task?.id !== previous.id) return current;
      if (!allowed || current.kind === "share" && !allowed.isOwner) return null;
      return { ...current, task: { ...current.task, canEdit: allowed.canEdit, isOwner: allowed.isOwner, source: allowed.source } };
    });
  }, [fetchNotes, sourceNoteId, t]);
  const fail = useCallback((failure: unknown) => {
    if (failure instanceof Error && failure.name === "AbortError") return;
    if (failure instanceof SnapshotAccessRevoked) { setData({ tasks: [], people: [], canCreate: false }); setModal(null); }
    setErrors({ list: failure instanceof Error ? failure.message : t("loadFailed") });
  }, [t]);
  const refresh = useCallback(async () => { await apply(await read()); }, [apply, read]);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then(async (next) => {
      await apply(next, controller.signal);
      if (controller.signal.aborted) return;
      if (focus === "new" && next.canCreate) setModal({ kind: "edit", task: null });
      else if (focus && focus !== "new") {
        const response = await fetchNotes(`/api/notes/tasks/${encodeURIComponent(focus)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || sourceNoteId && payload.task?.source?.id !== sourceNoteId || modalKind === "share" && !payload.task?.isOwner) throw new Error(payload.error ?? t("notFound"));
        if (!controller.signal.aborted) setModal((current) => current?.task?.id === focus && current.kind === modalKind ? current : { kind: modalKind, task: payload.task });
      }
    }).catch((failure) => { if (!controller.signal.aborted) fail(failure); });
    const poll = () => { void read(controller.signal).then((next) => apply(next, controller.signal)).catch((failure) => { if (!controller.signal.aborted) fail(failure); }); };
    const timer = window.setInterval(poll, 30_000); window.addEventListener("focus", poll);
    return () => { controller.abort(); request.current?.abort(); window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [apply, fail, focus, modalKind, sourceNoteId, read, t, fetchNotes]);
  useEffect(() => { if (errors.list) errorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [errors.list]);
  async function save(input: TaskCreate | TaskPatch, id?: string) {
    const response = await fetchNotes(id ? `/api/notes/tasks/${id}` : "/api/notes/tasks", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? t("saveFailed"));
    await refresh(); close();
  }
  async function change(task: NoteTaskSummary, patch: Partial<TaskPatch>, control?: HTMLElement) {
    if (pending) return;
    setPending(task.id); setErrors((current) => ({ ...current, [task.id]: "" }));
    try { await save({ ...patch, expectedVersion: task.version, requestId: crypto.randomUUID() }, task.id); }
    catch (failure) { setErrors((current) => ({ ...current, [task.id]: failure instanceof Error ? failure.message : t("saveFailed") })); control?.scrollIntoView({ block: "nearest" }); }
    finally { setPending(null); }
  }
  const ready = data.queryKey === endpoint;
  const visible = ready ? data.tasks.filter((task) => filter === "archived" ? task.archived : !task.archived && (filter === "active" ? task.status === "open" || task.status === "in_progress" : filter === "all" || task.status === filter)) : [];
  const button = "rounded-lg border border-hq-border px-3 py-2 text-xs disabled:opacity-40";
  return <section className={`min-w-0 flex-1 ${sourceNoteId ? "space-y-3 border-t border-hq-border pt-4" : "space-y-5 p-5 sm:p-7"}`} data-testid="notes-tasks">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><CheckSquare className="h-4 w-4" />{t(sourceNoteId ? "tasks.linked" : "tasks.heading")}</h2>{data.canCreate ? <button type="button" onClick={() => open(null)} className="flex items-center gap-1.5 rounded-lg border border-hq-border px-3 py-2 text-xs"><Plus className="h-3.5 w-3.5" />{t("tasks.new")}</button> : null}</header>
    <select aria-label={t("tasks.filter")} value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-xs"><option value="active">{t("tasks.active")}</option><option value="all">{t("tasks.all")}</option>{TASK_STATUSES.map((status) => <option key={status} value={status}>{t(`tasks.status.${status}`)}</option>)}<option value="archived">{t("views.archived")}</option></select>
    {label && <button type="button" className={button} onClick={() => setLabel("")}>{label} · {t("workspace.clearFilters")}</button>}
    <div ref={errorAnchor}>{errors.list && <><p role="alert" className="text-sm text-hq-danger">{errors.list}</p><button type="button" className={button} onClick={() => void refresh().catch(fail)}>{t("workspace.retryLoading")}</button></>}</div>
    {ready && !visible.length && <p className="rounded-xl border border-dashed border-hq-border p-6 text-sm text-hq-fg-muted">{t("tasks.empty")}</p>}
    <div className="space-y-3">{visible.map((task) => <article key={task.id} data-testid="note-task" data-task-id={task.id} className="space-y-3 rounded-xl border border-hq-border bg-hq-canvas p-4">
      <div className="flex items-start justify-between gap-3"><button type="button" onClick={() => open(task)} className="min-w-0 flex-1 text-left"><h3 className="text-sm font-semibold">{task.title}</h3>{task.excerpt && <p className="mt-1 line-clamp-2 text-xs text-hq-fg-muted">{task.excerpt}</p>}</button>{task.isOwner && <button type="button" aria-label={t("tasks.share")} onClick={() => open(task, "share")} className="rounded p-1 text-hq-fg-muted"><Share2 className="h-4 w-4" /></button>}</div>
      <div className="flex flex-wrap gap-2">{task.labels.map((value) => <button type="button" key={value} className="text-xs text-hq-accent" onClick={() => setLabel(value)}>{value}</button>)}</div>
      <TaskStateFields status={task.status} priority={task.priority} disabled={!task.canEdit || !!pending} onStatus={(status) => void change(task, { status })} onPriority={(priority) => void change(task, { priority })} />
      <div className="flex flex-wrap items-center gap-3 text-xs text-hq-fg-muted"><span>{task.assignee?.name ?? task.legacyAssigneeName ?? t("tasks.unassigned")}</span>{task.dueAt && <time dateTime={task.dueAt}>{formatAccountDate(task.dueAt, { locale, timezoneId: "server", dateStyle: "medium" })}</time>}{task.source && !sourceNoteId && <Link href={`/notes/${task.source.id}`} className="text-hq-accent">{task.source.title}</Link>}</div>
      {errors[task.id] && <p role="alert" className="rounded bg-hq-danger/10 p-2 text-xs text-hq-danger">{errors[task.id]}</p>}
    </article>)}</div>
    <div className="flex gap-2"><button type="button" className={button} disabled={!ready || !data.previousCursor && !(cursor && !visible.length)} onClick={() => setCursor(data.previousCursor ?? null)}>{t("imports.previous")}</button><button type="button" className={button} disabled={!ready || !data.nextCursor} onClick={() => setCursor(data.nextCursor ?? null)}>{t("imports.next")}</button></div>
    {modal?.kind === "edit" && <NoteTaskEditor key={modal.task?.id ?? "new"} task={modal.task} sourceNoteId={sourceNoteId} people={data.people} onClose={close} onSave={save} />}
    {modal?.kind === "share" && modal.task && <NoteShareDialog task note={{ id: modal.task.id, title: modal.task.title, body: modal.task.description ?? "" }} onClose={close} onSaved={refresh} />}
  </section>;
}
