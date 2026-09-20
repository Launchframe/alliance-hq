"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { NotesNavigation, useNotesNavigation, useNotesFetch, useNotesDirtyState } from "./NotesNavigation";
import { useWorkspacePreferences } from "./useWorkspacePreferences";
import { Archive, ArrowRight, ArrowUpDown, BookOpen, Check, ChevronRight, FileText, Filter, Flag, FolderOpen, Globe2, Inbox, LayoutGrid, List, LockKeyhole, MessageSquare, Plus, Search, Share2, StickyNote, X } from "lucide-react";
import type { PerformanceNoteDto, PerformanceNoteSummary, NotesWorkspacePayload } from "@/lib/performance-notes/types.shared";
import { NOTE_PRIORITIES, NOTE_LIST_VIEWS, noteListUrl, noteFilterFromWorkspace, readWorkspaceState, workspaceStateLocation, scopedWorkspaceLocation, noteWorkspaceStateSchema, notesFocusKey, type NoteFields, type NotePatch, type NoteWorkspaceView, type NoteWorkspaceState } from "@/lib/notes/workspace.shared";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { NoteEditor } from "./NoteEditor";
import { NoteTasksPanel } from "./NoteTasksPanel";
import { NoteBoardsClient } from "./NoteBoardsClient";
import { NoteDraftsPanel } from "./NoteDraftsPanel";
import { NoteHistoryImports } from "./NoteHistoryImports";
import { NoteWorkspaceSearch } from "./NoteWorkspaceSearch";
import { NoteKnowledge } from "./NoteKnowledge";
import { NoteStudio } from "./NoteStudio";
import { NotePublications } from "./NotePublications";
import { draftStateSchema, type CaptureDraft } from "@/lib/notes/drafts.shared";
import type { CaptureCommit } from "@/lib/notes/intake.shared";
import { NoteShareDialog } from "./NoteShareDialog";
import { NoteHistoryDialog } from "./NoteHistoryDialog";

type Modal = { kind: "editor"; note: PerformanceNoteDto | null; body?: string; resume?: CaptureDraft } | { kind: "share" | "history"; note: PerformanceNoteDto } | null;
const viewIcons = { publications: Share2, studio: FileText, knowledge: BookOpen, search: Search, notebook: BookOpen, imports: FolderOpen, drafts: FileText, inbox: Inbox, tasks: List, boards: LayoutGrid, shared: Share2, archived: Archive };
const priorityClass = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-orange-600 dark:text-orange-400", urgent: "text-rose-600 dark:text-rose-400" };

type Props = { initial: NotesWorkspacePayload; focusedNote?: PerformanceNoteDto | null };
export function NotesClient(props: Props) {
  return <NotesNavigation key={props.initial.scope} scope={props.initial.scope} defaults={props.initial.preferences.state}><NotesWorkspace {...props} /></NotesNavigation>;
}
function NotesWorkspace({ initial, focusedNote }: Props) {
  const t = useTranslations("notes");
  const locale = useLocale();
  const navigation = useNotesNavigation();
  const params = navigation.params;
  const fetchNotes = useNotesFetch();
  const state = useMemo(() => readWorkspaceState(params, initial.preferences.state, initial.scope), [params, initial.preferences.state, initial.scope]);
  const { view, notebook, q: query, source, priority, sort, layout, label, member } = state;
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [accessDenied, setAccessDenied] = useState(false);
  const urlCursor = params.get("cursor");
  const pagePosition = useRef({ cursor: params.get("cursor"), key: JSON.stringify(initial.filter) });
  const [pageKey, setPageKey] = useState(JSON.stringify(initial.filter));
  const [loading, setLoading] = useState(false);
  const filter = useMemo(() => noteFilterFromWorkspace({ view, q: query, notebook, source, priority, sort, label, member }), [view, query, notebook, source, priority, sort, label, member]);
  const filterKey = JSON.stringify(filter);
  const [capture, setCapture] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [filing, setFiling] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(() => focusedNote ? { kind: "editor", note: focusedNote } : null);
  const modalRef = useRef(modal);
  useEffect(() => { modalRef.current = modal; }, [modal]);
  const importId = params.get("import");
  const [creatingNote, setCreatingNote] = useState(false);
  const editingSearch = useRef(false);
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const opening = useRef<AbortController | null>(null);
  const scheduledRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const clearFocus = useCallback((resetPage = false) => {
    const url = new URL(navigation.store.getSnapshot().url, window.location.origin);
    url.pathname = url.pathname.replace(/\/notes\/[^/]+$/, "/notes");
    url.searchParams.delete("note"); url.searchParams.delete("draft"); url.searchParams.delete("noteTask");
    if (resetPage) url.searchParams.delete("cursor");
    navigation.store.request({ url: scopedWorkspaceLocation(`${url.pathname}${url.search}`, initial.preferences.state, initial.scope), mode: "replace" }, true);
  }, [navigation.store, initial.preferences.state, initial.scope]);
  const revoke = useCallback(() => {
    navigation.store.reset(); clearFocus(); opening.current?.abort(); setModal(null); setCapture(""); setCreatingNote(false); setAccessDenied(true);
    setData((current) => ({ ...current, items: [], roster: [], notebooks: [], counts: { notebook: 0, inbox: 0, shared: 0, archived: 0 }, canCreate: false, canReadBoards: false, draftCount: 0 }));
    router.refresh();
  }, [router, navigation.store, clearFocus]);
  const preferences = useWorkspacePreferences(initial.preferences, state, revoke);
  const preferenceErrorAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { if (preferences.error) preferenceErrorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [preferences.error]);
  const changeState = useCallback((patch: Partial<NoteWorkspaceState>, replace = false) => {
    const next = noteWorkspaceStateSchema.parse({ ...state, ...patch });
    const changes: Record<string, string | null> = Object.keys(patch).some((key) => ["view", "q", "notebook", "source", "priority", "sort", "label", "member"].includes(key)) ? { cursor: null } : {};
    if (patch.taskFilter !== undefined || patch.taskLabel !== undefined) changes.taskCursor = null;
    if (patch.view !== undefined && patch.view !== view) Object.assign(changes, { note: null, draft: null, noteTask: null, board: null, task: null, import: null, job: null, knowledge: null });
    navigation.go(workspaceStateLocation(navigation.pathname, params.toString(), next, initial.scope, changes), replace);
  }, [state, view, navigation, params, initial.scope]);
  const chooseView = useCallback((next: NoteWorkspaceView) => changeState({ view: next, notebook: "" }), [changeState]);
  const setNotebook = (value: string) => changeState({ view: "notebook", notebook: value });
  const setQuery = (value: string) => { changeState({ q: value }, editingSearch.current); editingSearch.current = true; };
  const setSource = (value: string) => changeState({ source: value as NoteWorkspaceState["source"] });
  const setPriority = (value: string) => changeState({ priority: value as NoteWorkspaceState["priority"] });
  const setSort = (value: string) => changeState({ sort: value as NoteWorkspaceState["sort"] });
  const setLayout = (value: "cards" | "list") => changeState({ layout: value });
  const draftRequest = useRef({ body: "", id: "" });
  const createDraft = useCallback(async (body: string, signal?: AbortSignal) => {
    if (!draftRequest.current.id || draftRequest.current.body !== body) draftRequest.current = { body, id: crypto.randomUUID() };
    const id = draftRequest.current.id;
    const response = await fetchNotes(`/api/notes/drafts/${id}`, { method: "PUT", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: 0, state: draftStateSchema.parse({ fields: { body, priorityMode: "auto" } }) }) });
    const draft: CaptureDraft & { error?: string } = await response.json();
    if (!response.ok) { if ([401, 403].includes(response.status)) revoke(); throw new Error(draft.error ?? t("saveFailed")); }
    if (draftRequest.current.id === id) draftRequest.current.id = "";
    window.dispatchEvent(new Event("notes-workspace-refresh"));
    return draft;
  }, [fetchNotes, revoke, t]);
  useNotesDirtyState({ dirty: !!capture.trim(), keys: ["pathname"], discard: () => setCapture(""), keep: async () => { await createDraft(capture); setCapture(""); } });
  useEffect(() => {
    if (!capture.trim()) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [capture]);
  const newNote = useCallback((body = capture) => {
    if (creatingNote || !data.canCreate) return;
    navigation.run(() => {
      const controller = new AbortController(); opening.current?.abort(); opening.current = controller;
      setCreatingNote(true); setError(null);
      void createDraft(body, controller.signal)
        .then((draft) => {
          if (!alive.current || controller.signal.aborted) return;
          navigation.change({ draft: draft.id, note: null, noteTask: null }, false, true);
          setModal({ kind: "editor", note: null, resume: draft }); setCapture("");
        }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("saveFailed")); })
        .finally(() => { if (alive.current) setCreatingNote(false); });
    }, !modal);
  }, [capture, creatingNote, data.canCreate, navigation, createDraft, modal, t]);
  const hotkeys = useMemo(() => ({
    "notes.drafts": () => chooseView("drafts"),
    "notes.imports": () => chooseView("imports"),
    "notes.workspaceSearch": () => chooseView("search"),
    "notes.knowledge": () => chooseView("knowledge"),
    "notes.studio": () => chooseView("studio"),
    "notes.publications": () => chooseView("publications"),
    "notes.sharedBoards": () => { if (data.canReadBoards) chooseView("boards"); },
    "notes.newNote": () => newNote(),
    "notes.search": () => queryInput.current?.focus(),
  }), [data.canReadBoards, chooseView, newNote]);
  useRegisterPageHotkeys(hotkeys, !modal);
  const focusKey = notesFocusKey(navigation.pathname, params);
  const lastFocus = useRef(focusKey);
  useEffect(() => navigation.store.subscribe(() => {
    const url = new URL(navigation.store.getSnapshot().url, window.location.origin);
    const next = notesFocusKey(url.pathname, url.searchParams);
    if (next !== lastFocus.current) { lastFocus.current = next; opening.current?.abort(); setModal(null); }
  }), [navigation.store]);
  useEffect(() => {
    const reset = () => { editingSearch.current = false; };
    window.addEventListener("popstate", reset);
    return () => window.removeEventListener("popstate", reset);
  }, []);

  const refresh = useCallback(async (next?: string | null) => {
    if (scheduledRefresh.current) { clearTimeout(scheduledRefresh.current); scheduledRefresh.current = null; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const cursor = next === undefined ? urlCursor : next;
    setLoading(true);
    try {
      const response = await fetchNotes(noteListUrl(filter, cursor), { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!alive.current || controller.signal.aborted) return false;
      if (!response.ok) {
        if ([401, 403].includes(response.status)) revoke();
        throw new Error(body.error ?? t("loadFailed"));
      }
      if (body.scope !== initial.scope) { revoke(); return false; }
      const focused = modalRef.current;
      let detailNote: PerformanceNoteDto | null | undefined;
      if (focused?.note && !(body as NotesWorkspacePayload).items.some((note) => note.id === focused.note!.id)) {
        const detail = await fetchNotes(`/api/notes/${encodeURIComponent(focused.note.id)}`, { cache: "no-store", signal: controller.signal });
        if ([401, 403, 404].includes(detail.status)) detailNote = null;
        else {
          const payload = await detail.json();
          if (!detail.ok) throw new Error(payload.error ?? t("loadFailed"));
          if (payload.scope !== initial.scope) { revoke(); return false; }
          detailNote = payload.note ?? null;
        }
      }
      if (!alive.current || controller.signal.aborted) return false;
      pagePosition.current = { cursor, key: filterKey };
      setPageKey(filterKey); setData((current) => ({ ...current, ...body })); setError(null); setAccessDenied(false);
      if (focused?.note && detailNote === null && !(body as NotesWorkspacePayload).items.some((note) => note.id === focused.note!.id)) clearFocus();
      setModal((current) => {
        if (!current?.note) return current;
        const latest = (body as NotesWorkspacePayload).items.find((note) => note.id === current.note!.id) ?? (current.note.id === focused?.note?.id ? detailNote : undefined);
        if (latest === null || current.kind !== "editor" && (!latest || !latest.isOwner)) return null;
        return latest ? { ...current, note: { ...current.note, canEdit: latest.canEdit, isOwner: latest.isOwner, shared: latest.shared, version: latest.version } } : current;
      });
      return true;
    } catch (failure) {
      if (alive.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed"));
      return false;
    } finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [filter, filterKey, urlCursor, initial.scope, revoke, clearFocus, t, fetchNotes]);

  useEffect(() => {
    alive.current = true;
    const check = () => { void refresh(); };
    if (pagePosition.current.key !== filterKey || pagePosition.current.cursor !== urlCursor) scheduledRefresh.current = setTimeout(check, 200);
    window.addEventListener("focus", check);
    window.addEventListener("notes-workspace-refresh", check);
    const timer = window.setInterval(check, 30_000);
    return () => { alive.current = false; request.current?.abort(); opening.current?.abort(); if (scheduledRefresh.current) clearTimeout(scheduledRefresh.current); window.removeEventListener("focus", check); window.removeEventListener("notes-workspace-refresh", check); window.clearInterval(timer); };
  }, [refresh, filterKey, urlCursor]);

  const draftParam = params.get("draft");
  const openDraft = useCallback(async (id: string, signal?: AbortSignal) => {
    const response = await fetchNotes(`/api/notes/drafts/${id}`, { cache: "no-store", signal });
    const restored: CaptureDraft & { error?: string } = await response.json();
    if (!response.ok) throw new Error(restored.error ?? t("notFound"));
    const noteId = restored.sourceNoteId ?? restored.noteId;
    let note: PerformanceNoteDto | null = null;
    if (noteId) {
      const noteResponse = await fetchNotes(`/api/notes/${noteId}`, { cache: "no-store", signal });
      const payload = await noteResponse.json();
      if (!noteResponse.ok) throw new Error(payload.error ?? t("notFound"));
      note = payload.note;
    }
    if (!signal?.aborted) setModal({ kind: "editor", note, ...(restored.status === "open" ? { resume: restored } : {}) });
  }, [t, fetchNotes]);
  useEffect(() => {
    if (!focusKey) return;
    const controller = new AbortController();
    if (draftParam) {
      if (modalRef.current?.kind === "editor" && modalRef.current.resume?.id === draftParam) return;
      void openDraft(draftParam, controller.signal).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); });
    } else {
      const noteId = focusKey.slice("note:".length);
      if (modalRef.current?.note?.id === noteId) return;
      void fetchNotes(`/api/notes/${encodeURIComponent(noteId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? t("notFound"));
        if (body.scope !== initial.scope) { revoke(); return; }
        setData((current) => ({ ...current, roster: body.roster })); setModal({ kind: "editor", note: body.note });
      }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); });
    }
    return () => controller.abort();
  }, [focusKey, draftParam, openDraft, fetchNotes, initial.scope, revoke, t]);

  function openNote(summary: PerformanceNoteSummary, kind: "editor" | "share" = "editor") {
    navigation.run(() => { void loadNote(summary, kind); }, !modal);
  }
  async function loadNote(summary: PerformanceNoteSummary, kind: "editor" | "share") {
    opening.current?.abort();
    const controller = new AbortController(); opening.current = controller;
    setCardErrors((current) => ({ ...current, [summary.id]: "" }));
    try {
      const response = await fetchNotes(`/api/notes/${encodeURIComponent(summary.id)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!alive.current || controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? t("notFound"));
      if (body.scope !== initial.scope) { revoke(); return; }
      navigation.change({ note: summary.id, draft: null, noteTask: null }, false, true);
      setData((current) => ({ ...current, roster: body.roster }));
      setModal({ kind, note: body.note });
    } catch (failure) { if (!controller.signal.aborted) setCardErrors((current) => ({ ...current, [summary.id]: failure instanceof Error ? failure.message : t("loadFailed") })); }
  }
  function closeModal(resetPage = false) {
    opening.current?.abort(); setModal(null);
    clearFocus(resetPage);
  }
  async function save(fields: NoteFields | NotePatch | CaptureCommit, noteId?: string) {
    const response = await fetchNotes(noteId ? `/api/notes/${noteId}` : "tasks" in fields ? "/api/notes/capture" : "/api/notes?format=summary", {
      method: noteId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error ?? t("saveFailed"));
    setNotice(t("workspace.saved")); closeModal(true);
    await refresh(null);
  }
  async function fileNote(note: PerformanceNoteSummary, control: HTMLButtonElement) {
    if (filing) return;
    setFiling(note.id); setCardErrors((current) => ({ ...current, [note.id]: "" }));
    try { await save({ expectedVersion: note.version, inbox: !note.inbox }, note.id); }
    catch (failure) {
      setCardErrors((current) => ({ ...current, [note.id]: failure instanceof Error ? failure.message : t("saveFailed") }));
      requestAnimationFrame(() => control.closest("article")?.scrollIntoView({ block: "nearest" }));
    } finally { setFiling(null); }
  }

  const counts = { ...data.counts, tasks: undefined, boards: undefined, drafts: data.draftCount, imports: undefined, search: undefined, knowledge: undefined, studio: undefined, publications: undefined };
  const notebooks = useMemo(() => [...data.notebooks].sort((a, b) => a.localeCompare(b, locale)), [data.notebooks, locale]);
  const visible = pageKey === filterKey ? data.items : [];
  const ViewIcon = viewIcons[view];
  const filtered = !!(query || source || priority !== "all" || label || member || notebook);
  const memberName = data.roster.find((item) => item.ashedMemberId === member)?.name ?? data.items.flatMap((item) => item.members).find((item) => item.ashedMemberId === member)?.name;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value));

  if (accessDenied) return <main className="p-6"><p role="alert">{error ?? t("errors.forbidden")}</p></main>;
  return <main className="min-h-[calc(100dvh-4rem)] min-w-0 bg-hq-canvas" data-testid="notes-workspace">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hq-border px-5 py-5 sm:px-7"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hq-accent/10 text-hq-accent"><StickyNote className="h-5 w-5" /></span><div><h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-0.5 text-xs text-hq-fg-muted">{t("subtitle")}</p></div></div>{data.canCreate ? <button type="button" disabled={creatingNote} onClick={() => newNote()} className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"><Plus className="h-4 w-4" />{t("actions.newNote")}</button> : null}</header>
    {preferences.error && <div ref={preferenceErrorAnchor} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><p role="alert" className="text-hq-danger">{preferences.error}</p><button disabled={preferences.saving} onClick={() => { void preferences.retry(); }} className="rounded-lg border border-hq-border px-3 py-2">{t("workspace.preferencesRetry")}</button></div>}
    {error && !NOTE_LIST_VIEWS.includes(view as typeof NOTE_LIST_VIEWS[number]) && view !== "drafts" && <p role="alert" className="px-5 py-3 text-sm text-hq-danger">{error}</p>}
    <nav className="m-3 flex gap-1 overflow-x-auto rounded-lg bg-hq-surface p-1 lg:hidden" aria-label={t("workspace.navigation")}>{(Object.keys(viewIcons) as NoteWorkspaceView[]).filter((item) => item !== "boards" || data.canReadBoards).map((item) => <button key={item} onClick={() => chooseView(item)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${view === item ? "bg-hq-canvas font-semibold shadow-sm" : "text-hq-fg-muted"}`}>{t(`views.${item}`)} <span className="ml-1 opacity-60">{counts[item]?.toLocaleString(locale)}</span></button>)}</nav>
    <div className="flex min-w-0">
      <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-hq-border bg-hq-surface/50 p-4 lg:flex">
        <nav className="space-y-1" aria-label={t("workspace.navigation")}>{(Object.keys(viewIcons) as NoteWorkspaceView[]).filter((item) => item !== "boards" || data.canReadBoards).map((item) => {
          const Icon = viewIcons[item];
          return <button key={item} type="button" onClick={() => chooseView(item)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm ${view === item && !notebook ? "bg-hq-accent/10 font-medium text-hq-accent" : "text-hq-fg-muted hover:bg-hq-surface-muted"}`}><Icon className="h-4 w-4" /><span className="flex-1">{t(`views.${item}`)}</span><span className="text-xs tabular-nums opacity-70">{counts[item]?.toLocaleString(locale)}</span></button>;
        })}</nav>
        <section><h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-hq-fg-muted">{t("workspace.notebooks")}</h2>{notebooks.length ? notebooks.map((name) => <button key={name} onClick={() => setNotebook(name)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${notebook === name ? "bg-hq-accent/10 text-hq-accent" : "text-hq-fg-muted hover:bg-hq-surface-muted"}`}><FolderOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{name}</span></button>) : <p className="px-3 text-xs leading-5 text-hq-fg-muted">{t("workspace.notebooksHint")}</p>}</section>
        <div className="mt-auto rounded-xl border border-hq-border bg-hq-canvas p-3 text-xs leading-5 text-hq-fg-muted"><LockKeyhole className="mb-2 h-4 w-4 text-hq-accent" />{t("editor.memberPrivacy")}</div>
      </aside>
      {view === "publications" ? <NotePublications scope={initial.scope} /> : view === "studio" ? <NoteStudio canCreate={data.canCreate} onChanged={async () => { await refresh(); }} /> : view === "knowledge" ? <NoteKnowledge onChanged={async () => { await refresh(); }} /> : view === "search" ? <NoteWorkspaceSearch /> : view === "imports" ? <NoteHistoryImports canCreate={data.canCreate} focusId={importId} onOpen={(id) => navigation.change({ view: "imports", import: id, messageOffset: null }, false, true)} /> : view === "drafts" ? <div className="min-w-0 flex-1">{error ? <p role="alert" className="p-4 text-hq-danger">{error}</p> : null}<NoteDraftsPanel refreshKey={!!modal} onOpen={(id) => navigation.change({ draft: id, note: null })} /></div> : view === "boards" ? data.canReadBoards ? <NoteBoardsClient /> : <p className="p-6">{t("errors.forbidden")}</p> : view === "tasks" ? <NoteTasksPanel focusId={params.get("task") ?? undefined} filterValue={state.taskFilter} onFilterChange={(value) => changeState({ taskFilter: value as NoteWorkspaceState["taskFilter"] })} /> : <section className="min-w-0 flex-1 px-4 py-5 sm:px-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2 text-sm text-hq-fg-muted"><ViewIcon className="h-4 w-4" /><span>{t(`views.${view}`)}</span>{notebook ? <><ChevronRight className="h-3 w-3" /><span className="truncate font-medium text-hq-fg">{notebook}</span></> : null}<span className="ml-1 rounded-md bg-hq-surface px-1.5 py-0.5 text-xs">{visible.length.toLocaleString(locale)}</span></div><div className="flex items-center gap-1 rounded-lg border border-hq-border p-0.5"><button type="button" aria-label={t("workspace.cardView")} aria-pressed={layout === "cards"} onClick={() => setLayout("cards")} className={`rounded-md p-1.5 ${layout === "cards" ? "bg-hq-surface-muted" : "text-hq-fg-muted"}`}><LayoutGrid className="h-4 w-4" /></button><button type="button" aria-label={t("workspace.listView")} aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={`rounded-md p-1.5 ${layout === "list" ? "bg-hq-surface-muted" : "text-hq-fg-muted"}`}><List className="h-4 w-4" /></button></div></div>
        {data.canCreate && view !== "shared" && view !== "archived" ? <form onSubmit={(event) => { event.preventDefault(); newNote(capture); }} className="mb-5 flex items-center gap-3 rounded-xl border border-dashed border-hq-border bg-hq-surface/50 px-4 py-3 focus-within:border-hq-accent"><Plus className="h-4 w-4 shrink-0 text-hq-fg-muted" /><input maxLength={100000} disabled={creatingNote} value={capture} onChange={(event) => setCapture(event.target.value)} aria-label={t("workspace.quickCapture")} placeholder={t("workspace.capturePlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-hq-fg-muted" /><button type="submit" aria-label={t("actions.newNote")} className="rounded-lg bg-hq-canvas p-2 text-hq-accent shadow-sm"><ArrowRight className="h-4 w-4" /></button></form> : null}
        <div className="mb-6 flex flex-wrap gap-2"><div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3"><Search className="h-4 w-4 shrink-0 text-hq-fg-muted" /><input ref={queryInput} type="search" maxLength={200} onFocus={() => { editingSearch.current = false; }} onBlur={() => { editingSearch.current = false; }} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("workspace.search")} placeholder={t("workspace.search")} className="w-full bg-transparent py-2 text-sm outline-none" /></div><label className="flex items-center gap-1 rounded-lg border border-hq-border px-2"><Filter className="h-3.5 w-3.5 text-hq-fg-muted" /><select aria-label={t("source.label")} value={source} onChange={(event) => setSource(event.target.value)} className="bg-hq-canvas py-2 text-xs outline-none"><option value="">{t("source.all")}</option><option value="web">{t("source.web")}</option><option value="discord">{t("source.discord")}</option></select></label><select aria-label={t("fields.priority")} value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-hq-border bg-hq-canvas px-2 py-2 text-xs outline-none"><option value="all">{t("priority.all")}</option>{["none", ...NOTE_PRIORITIES].map((value) => <option key={value} value={value}>{t(`priority.${value}`)}</option>)}</select><label className="flex items-center gap-1 rounded-lg border border-hq-border px-2"><ArrowUpDown className="h-3.5 w-3.5 text-hq-fg-muted" /><select aria-label={t("workspace.sort")} value={sort} onChange={(event) => setSort(event.target.value)} className="bg-hq-canvas py-2 text-xs outline-none"><option value="recent">{t("workspace.recent")}</option><option value="priority">{t("fields.priority")}</option></select></label></div>
        {(label || member) && <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">{label && <span className="rounded bg-hq-accent/10 px-2 py-1">{t("fields.labels")}: {label}</span>}{member && <span className="rounded bg-hq-accent/10 px-2 py-1">{t("fields.members")}{memberName ? `: ${memberName}` : ""}</span>}<button type="button" className="rounded border border-hq-border px-2 py-1" onClick={() => changeState({ label: "", member: "" })}>{t("workspace.clearFilters")}</button></div>}
        {error ? <p role="alert" className="mb-4 rounded-lg border border-hq-danger/20 bg-hq-danger/5 px-4 py-3 text-sm text-hq-danger">{error}</p> : null}
        {notice ? <div role="status" className="mb-4 flex items-center justify-between rounded-lg bg-hq-success/10 px-3 py-2 text-xs text-hq-success"><span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5" />{notice}</span><button onClick={() => setNotice("")} aria-label={t("actions.close")}><X className="h-3.5 w-3.5" /></button></div> : null}
        {!visible.length ? <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-hq-border px-5 py-12 text-center"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-hq-surface"><ViewIcon className="h-6 w-6 text-hq-fg-muted" /></span><h2 className="text-base font-semibold">{filtered ? t("workspace.noMatches") : t(`workspace.empty.${view}`)}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-hq-fg-muted">{filtered ? t("workspace.changeFilters") : t(`workspace.hint.${view}`)}</p>{filtered ? <button onClick={() => changeState({ q: "", source: "", priority: "all", notebook: "", label: "", member: "" })} className="mt-4 text-sm font-medium text-hq-accent">{t("workspace.clearFilters")}</button> : data.canCreate && view === "notebook" ? <button disabled={creatingNote} onClick={() => newNote()} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-hq-border px-4 py-2 text-sm font-medium"><Plus className="h-4 w-4" />{t("actions.newNote")}</button> : null}</div> : <div className={layout === "cards" ? "grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" : "space-y-2"}>
          {visible.map((note) => {
            const SourceIcon = note.source === "discord" ? MessageSquare : Globe2;
            return <article key={note.id} data-testid="note-card" data-note-id={note.id} className={`group rounded-xl border border-hq-border bg-hq-canvas transition-shadow hover:border-hq-accent/40 hover:shadow-md ${layout === "list" ? "flex flex-wrap items-center gap-3 px-4 py-3" : "flex min-h-52 flex-col p-4"}`}>
              <button type="button" onClick={() => void openNote(note)} className={`min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-hq-accent ${layout === "list" ? "flex-1" : "flex-1"}`}><div className="mb-2 flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-hq-fg-muted" />{note.priority ? <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${priorityClass[note.priority]}`}><Flag className="h-3 w-3" />{t(`priority.${note.priority}`)}</span> : null}{note.kind !== "note" ? <span className={`rounded px-1.5 py-0.5 text-[10px] ${note.kind === "commendation" ? "bg-hq-success/10 text-hq-success" : "bg-hq-danger/10 text-hq-danger"}`}>{note.kind === "commendation" ? t("kindCommendation") : t("kindViolation")}</span> : null}</div><h3 className="line-clamp-2 text-sm font-semibold leading-6 text-hq-fg">{note.title || t("editor.untitled")}</h3>{layout === "cards" ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-hq-fg-muted">{note.excerpt}</p> : null}</button>{note.labels.length ? <div className="mt-3 flex flex-wrap gap-1.5">{note.labels.slice(0, 4).map((value) => <button type="button" key={value} onClick={() => changeState({ label: value })} className="rounded-md bg-hq-accent/8 px-2 py-1 text-[10px] font-medium text-hq-accent hover:bg-hq-accent/15">{value}</button>)}</div> : null}
              <div className={`flex items-center justify-between gap-2 ${layout === "cards" ? "mt-4 border-t border-hq-border/60 pt-3" : "min-w-40"}`}><div className="flex items-center gap-2 text-[10px] text-hq-fg-muted"><span className="inline-flex items-center gap-1" title={t("source.label")}><SourceIcon className="h-3 w-3" />{t(`source.${note.source}`)}</span><span title={note.shared ? t("sharing.shared") : t("editor.private")}>{note.shared ? <Share2 className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}</span>{note.members.length ? <div className="flex max-w-32 flex-wrap gap-1">{note.members.map((linked) => <button type="button" key={linked.ashedMemberId} onClick={() => changeState({ member: linked.ashedMemberId })} className="max-w-32 truncate rounded px-1 py-1 hover:bg-hq-surface-muted" title={linked.name}>{linked.name}</button>)}</div> : null}</div><div className="flex items-center gap-2"><time dateTime={note.updatedAt} className="whitespace-nowrap text-[10px] text-hq-fg-muted">{date(note.updatedAt)}</time>{note.isOwner && view === "inbox" ? <button type="button" disabled={!!filing} onClick={(event) => void fileNote(note, event.currentTarget)} title={t("actions.file")} aria-label={t("actions.file")} className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface hover:text-hq-success"><Check className="h-3.5 w-3.5" /></button> : null}{note.isOwner ? <button type="button" onClick={() => void openNote(note, "share")} aria-label={t("actions.share")} className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface hover:text-hq-accent"><Share2 className="h-3.5 w-3.5" /></button> : null}</div></div>
              {cardErrors[note.id] ? <p role="alert" className="mt-2 w-full rounded-lg bg-hq-danger/10 p-2 text-xs text-hq-danger">{cardErrors[note.id]}</p> : null}
            </article>;
          })}
        </div>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={loading || pageKey !== filterKey || !data.previousCursor && !(urlCursor && !data.items.length)} onClick={() => void refresh(data.previousCursor).then((loaded) => { if (loaded) navigation.change({ cursor: data.previousCursor }); })} className="rounded-lg border border-hq-border px-3 py-2 text-sm disabled:opacity-40">{t("imports.previous")}</button>
          <button type="button" disabled={loading || pageKey !== filterKey || !data.nextCursor} onClick={() => void refresh(data.nextCursor).then((loaded) => { if (loaded) navigation.change({ cursor: data.nextCursor }); })} className="rounded-lg border border-hq-border px-3 py-2 text-sm disabled:opacity-40">{t("imports.next")}</button>
        </div>
      </section>}
    </div>
    {modal?.kind === "editor" ? <NoteEditor key={modal.resume?.id ?? modal.note?.id ?? "new"} note={modal.note} resumeDraft={modal.resume} initialBody={modal.body} roster={data.roster} onClose={closeModal} onSave={save} onShare={(note) => setModal({ kind: "share", note })} onHistory={(note) => setModal({ kind: "history", note })} /> : null}
    {modal?.kind === "share" ? <NoteShareDialog key={modal.note.id} note={modal.note} onClose={closeModal} onSaved={async () => { await refresh(); }} /> : null}
    {modal?.kind === "history" ? <NoteHistoryDialog key={modal.note.id} note={modal.note} onClose={closeModal} onRestore={save} /> : null}
  </main>;
}
