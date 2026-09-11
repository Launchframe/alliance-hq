"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Archive, ArrowRight, ArrowUpDown, BookOpen, Check, ChevronRight, FileText, Filter, Flag, FolderOpen, Globe2, Inbox, LayoutGrid, List, LockKeyhole, MessageSquare, Plus, Search, Share2, StickyNote, X } from "lucide-react";
import type { PerformanceNoteDto, PerformanceNotesPagePayload } from "@/lib/performance-notes/types.shared";
import { NOTE_PRIORITIES, noteExcerpt, notePriorityRank, noteTitle, type NoteFields, type NotePatch, type NoteWorkspaceView } from "@/lib/notes/workspace.shared";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { NoteEditor } from "./NoteEditor";
import { NoteShareDialog } from "./NoteShareDialog";
import { NoteHistoryDialog } from "./NoteHistoryDialog";

type Modal = { kind: "editor"; note: PerformanceNoteDto | null; body?: string } | { kind: "share" | "history"; note: PerformanceNoteDto } | null;
const viewIcons = { notebook: BookOpen, inbox: Inbox, shared: Share2, archived: Archive };
const priorityClass = { low: "text-emerald-600 dark:text-emerald-400", medium: "text-amber-600 dark:text-amber-400", high: "text-orange-600 dark:text-orange-400", urgent: "text-rose-600 dark:text-rose-400" };

export function NotesClient({ initial, focusNoteId }: { initial: PerformanceNotesPagePayload; focusNoteId?: string }) {
  const t = useTranslations("notes");
  const locale = useLocale();
  const params = useSearchParams();
  const [data, setData] = useState(initial);
  const [view, setView] = useState<NoteWorkspaceView>(() => {
    const requested = params.get("view");
    return requested && Object.hasOwn(viewIcons, requested) ? requested as NoteWorkspaceView : "notebook";
  });
  const [notebook, setNotebook] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState<"cards" | "list">("cards");
  const [capture, setCapture] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [filing, setFiling] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(() => {
    const note = initial.notes.find((item) => item.id === (focusNoteId ?? params.get("note")));
    return note ? { kind: "editor", note } : null;
  });
  const alive = useRef(false);
  const request = useRef<AbortController | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const hotkeys = useMemo(() => ({
    "notes.newNote": () => { if (data.canCreate) setModal({ kind: "editor", note: null }); },
    "notes.search": () => queryInput.current?.focus(),
  }), [data.canCreate]);
  useRegisterPageHotkeys(hotkeys, !modal);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/notes", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!alive.current || controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setData((current) => ({ ...current, notes: [], roster: [], canCreate: false })); setModal(null); }
        throw new Error(body.error ?? t("loadFailed"));
      }
      if (alive.current && !controller.signal.aborted) {
        setData(body); setError(null);
        setModal((current) => {
          if (!current?.note) return current;
          const latest = (body as PerformanceNotesPagePayload).notes.find((note) => note.id === current.note!.id);
          if (!latest || (current.kind !== "editor" && !latest.isOwner)) return null;
          return { ...current, note: { ...current.note, canEdit: latest.canEdit, isOwner: latest.isOwner, shared: latest.shared } };
        });
      }
    } catch (failure) { if (alive.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); }
  }, [t]);

  useEffect(() => {
    alive.current = true;
    const check = () => { void refresh(); };
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 30_000);
    return () => { alive.current = false; request.current?.abort(); window.removeEventListener("focus", check); window.clearInterval(timer); };
  }, [refresh]);

  function chooseView(next: NoteWorkspaceView) {
    setView(next); setNotebook("");
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }
  function openNote(note: PerformanceNoteDto) {
    setModal({ kind: "editor", note });
    const url = new URL(window.location.href);
    url.searchParams.set("note", note.id);
    window.history.replaceState(null, "", url);
  }
  function closeModal() {
    setModal(null);
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/\/notes\/[^/]+$/, "/notes");
    url.searchParams.delete("note");
    window.history.replaceState(null, "", url);
  }
  async function save(fields: NoteFields | NotePatch, noteId?: string) {
    const response = await fetch(noteId ? `/api/notes/${noteId}` : "/api/notes", {
      method: noteId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error ?? t("saveFailed"));
    if (body.notes) setData(body);
    else if (body.note) setData((current) => ({ ...current, notes: current.notes.map((note) => note.id === body.note.id ? body.note : note) }));
    setCapture(""); setNotice(t("workspace.saved")); closeModal();
  }
  async function fileNote(note: PerformanceNoteDto, control: HTMLButtonElement) {
    if (filing) return;
    setFiling(note.id); setCardErrors((current) => ({ ...current, [note.id]: "" }));
    try { await save({ expectedVersion: note.version, inbox: !note.inbox }, note.id); }
    catch (failure) {
      setCardErrors((current) => ({ ...current, [note.id]: failure instanceof Error ? failure.message : t("saveFailed") }));
      requestAnimationFrame(() => control.closest("article")?.scrollIntoView({ block: "nearest" }));
    } finally { setFiling(null); }
  }

  const counts = useMemo(() => ({
    notebook: data.notes.filter((note) => note.isOwner && !note.archived).length,
    inbox: data.notes.filter((note) => note.isOwner && note.inbox && !note.archived).length,
    shared: data.notes.filter((note) => !note.isOwner && !note.archived).length,
    archived: data.notes.filter((note) => note.isOwner && note.archived).length,
  }), [data.notes]);
  const notebooks = useMemo(() => [...new Set(data.notes.filter((note) => note.isOwner && !note.archived && note.notebook).map((note) => note.notebook!))].sort((a, b) => a.localeCompare(b, locale)), [data.notes, locale]);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase(locale);
    return data.notes.filter((note) => {
      const inView = view === "archived" ? note.archived && note.isOwner : !note.archived && (view === "shared" ? !note.isOwner : note.isOwner && (view !== "inbox" || note.inbox));
      return inView && (!notebook || note.notebook === notebook) && (!source || note.source === source) && (priority === "all" || (note.priority ?? "none") === priority) && (!text || [noteTitle(note), note.body, ...note.labels, ...note.members.map((member) => member.name)].join(" ").toLocaleLowerCase(locale).includes(text));
    }).sort((a, b) => (sort === "priority" ? notePriorityRank(b.priority) - notePriorityRank(a.priority) : 0) || b.updatedAt.localeCompare(a.updatedAt));
  }, [data.notes, locale, notebook, priority, query, sort, source, view]);
  const ViewIcon = viewIcons[view];
  const filtered = !!(query || source || priority !== "all");
  const date = (value: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value));

  return <main className="min-h-[calc(100dvh-4rem)] min-w-0 bg-hq-canvas" data-testid="notes-workspace">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hq-border px-5 py-5 sm:px-7"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-hq-accent/10 text-hq-accent"><StickyNote className="h-5 w-5" /></span><div><h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1><p className="mt-0.5 text-xs text-hq-fg-muted">{t("subtitle")}</p></div></div>{data.canCreate ? <button type="button" onClick={() => setModal({ kind: "editor", note: null })} className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"><Plus className="h-4 w-4" />{t("actions.newNote")}</button> : null}</header>
    <div className="flex min-w-0">
      <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-hq-border bg-hq-surface/50 p-4 lg:flex">
        <nav className="space-y-1" aria-label={t("workspace.navigation")}>{(Object.keys(viewIcons) as NoteWorkspaceView[]).map((item) => {
          const Icon = viewIcons[item];
          return <button key={item} type="button" onClick={() => chooseView(item)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm ${view === item && !notebook ? "bg-hq-accent/10 font-medium text-hq-accent" : "text-hq-fg-muted hover:bg-hq-surface-muted"}`}><Icon className="h-4 w-4" /><span className="flex-1">{t(`views.${item}`)}</span><span className="text-xs tabular-nums opacity-70">{counts[item].toLocaleString(locale)}</span></button>;
        })}</nav>
        <section><h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-hq-fg-muted">{t("workspace.notebooks")}</h2>{notebooks.length ? notebooks.map((name) => <button key={name} onClick={() => { chooseView("notebook"); setNotebook(name); }} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${notebook === name ? "bg-hq-accent/10 text-hq-accent" : "text-hq-fg-muted hover:bg-hq-surface-muted"}`}><FolderOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{name}</span></button>) : <p className="px-3 text-xs leading-5 text-hq-fg-muted">{t("workspace.notebooksHint")}</p>}</section>
        <div className="mt-auto rounded-xl border border-hq-border bg-hq-canvas p-3 text-xs leading-5 text-hq-fg-muted"><LockKeyhole className="mb-2 h-4 w-4 text-hq-accent" />{t("editor.memberPrivacy")}</div>
      </aside>
      <section className="min-w-0 flex-1 px-4 py-5 sm:px-7">
        <nav className="mb-5 flex gap-1 overflow-x-auto rounded-lg bg-hq-surface p-1 lg:hidden" aria-label={t("workspace.navigation")}>{(Object.keys(viewIcons) as NoteWorkspaceView[]).map((item) => <button key={item} onClick={() => chooseView(item)} className={`whitespace-nowrap rounded-md px-3 py-2 text-xs ${view === item ? "bg-hq-canvas font-semibold shadow-sm" : "text-hq-fg-muted"}`}>{t(`views.${item}`)} <span className="ml-1 opacity-60">{counts[item]}</span></button>)}</nav>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2 text-sm text-hq-fg-muted"><ViewIcon className="h-4 w-4" /><span>{t(`views.${view}`)}</span>{notebook ? <><ChevronRight className="h-3 w-3" /><span className="truncate font-medium text-hq-fg">{notebook}</span></> : null}<span className="ml-1 rounded-md bg-hq-surface px-1.5 py-0.5 text-xs">{visible.length.toLocaleString(locale)}</span></div><div className="flex items-center gap-1 rounded-lg border border-hq-border p-0.5"><button type="button" aria-label={t("workspace.cardView")} aria-pressed={layout === "cards"} onClick={() => setLayout("cards")} className={`rounded-md p-1.5 ${layout === "cards" ? "bg-hq-surface-muted" : "text-hq-fg-muted"}`}><LayoutGrid className="h-4 w-4" /></button><button type="button" aria-label={t("workspace.listView")} aria-pressed={layout === "list"} onClick={() => setLayout("list")} className={`rounded-md p-1.5 ${layout === "list" ? "bg-hq-surface-muted" : "text-hq-fg-muted"}`}><List className="h-4 w-4" /></button></div></div>
        {data.canCreate && view !== "shared" && view !== "archived" ? <form onSubmit={(event) => { event.preventDefault(); setModal({ kind: "editor", note: null, body: capture }); }} className="mb-5 flex items-center gap-3 rounded-xl border border-dashed border-hq-border bg-hq-surface/50 px-4 py-3 focus-within:border-hq-accent"><Plus className="h-4 w-4 shrink-0 text-hq-fg-muted" /><input value={capture} onChange={(event) => setCapture(event.target.value)} aria-label={t("workspace.quickCapture")} placeholder={t("workspace.capturePlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-hq-fg-muted" /><button type="submit" aria-label={t("actions.newNote")} className="rounded-lg bg-hq-canvas p-2 text-hq-accent shadow-sm"><ArrowRight className="h-4 w-4" /></button></form> : null}
        <div className="mb-6 flex flex-wrap gap-2"><div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-hq-border bg-hq-canvas px-3"><Search className="h-4 w-4 shrink-0 text-hq-fg-muted" /><input ref={queryInput} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("workspace.search")} placeholder={t("workspace.search")} className="w-full bg-transparent py-2 text-sm outline-none" /></div><label className="flex items-center gap-1 rounded-lg border border-hq-border px-2"><Filter className="h-3.5 w-3.5 text-hq-fg-muted" /><select aria-label={t("source.label")} value={source} onChange={(event) => setSource(event.target.value)} className="bg-hq-canvas py-2 text-xs outline-none"><option value="">{t("source.all")}</option><option value="web">{t("source.web")}</option><option value="discord">{t("source.discord")}</option></select></label><select aria-label={t("fields.priority")} value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-hq-border bg-hq-canvas px-2 py-2 text-xs outline-none"><option value="all">{t("priority.all")}</option>{["none", ...NOTE_PRIORITIES].map((value) => <option key={value} value={value}>{t(`priority.${value}`)}</option>)}</select><label className="flex items-center gap-1 rounded-lg border border-hq-border px-2"><ArrowUpDown className="h-3.5 w-3.5 text-hq-fg-muted" /><select aria-label={t("workspace.sort")} value={sort} onChange={(event) => setSort(event.target.value)} className="bg-hq-canvas py-2 text-xs outline-none"><option value="recent">{t("workspace.recent")}</option><option value="priority">{t("fields.priority")}</option></select></label></div>
        {error ? <p role="alert" className="mb-4 rounded-lg border border-hq-danger/20 bg-hq-danger/5 px-4 py-3 text-sm text-hq-danger">{error}</p> : null}
        {notice ? <div role="status" className="mb-4 flex items-center justify-between rounded-lg bg-hq-success/10 px-3 py-2 text-xs text-hq-success"><span className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5" />{notice}</span><button onClick={() => setNotice("")} aria-label={t("actions.close")}><X className="h-3.5 w-3.5" /></button></div> : null}
        {!visible.length ? <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-hq-border px-5 py-12 text-center"><span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-hq-surface"><ViewIcon className="h-6 w-6 text-hq-fg-muted" /></span><h2 className="text-base font-semibold">{filtered ? t("workspace.noMatches") : t(`workspace.empty.${view}`)}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-hq-fg-muted">{filtered ? t("workspace.changeFilters") : t(`workspace.hint.${view}`)}</p>{filtered ? <button onClick={() => { setQuery(""); setSource(""); setPriority("all"); }} className="mt-4 text-sm font-medium text-hq-accent">{t("workspace.clearFilters")}</button> : data.canCreate && view === "notebook" ? <button onClick={() => setModal({ kind: "editor", note: null })} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-hq-border px-4 py-2 text-sm font-medium"><Plus className="h-4 w-4" />{t("actions.newNote")}</button> : null}</div> : <div className={layout === "cards" ? "grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" : "space-y-2"}>
          {visible.map((note) => {
            const SourceIcon = note.source === "discord" ? MessageSquare : Globe2;
            return <article key={note.id} data-testid="note-card" data-note-id={note.id} className={`group rounded-xl border border-hq-border bg-hq-canvas transition-shadow hover:border-hq-accent/40 hover:shadow-md ${layout === "list" ? "flex flex-wrap items-center gap-3 px-4 py-3" : "flex min-h-52 flex-col p-4"}`}>
              <button type="button" onClick={() => openNote(note)} className={`min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-hq-accent ${layout === "list" ? "flex-1" : "flex-1"}`}><div className="mb-2 flex items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-hq-fg-muted" />{note.priority ? <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${priorityClass[note.priority]}`}><Flag className="h-3 w-3" />{t(`priority.${note.priority}`)}</span> : null}{note.kind !== "note" ? <span className={`rounded px-1.5 py-0.5 text-[10px] ${note.kind === "commendation" ? "bg-hq-success/10 text-hq-success" : "bg-hq-danger/10 text-hq-danger"}`}>{note.kind === "commendation" ? t("kindCommendation") : t("kindViolation")}</span> : null}</div><h3 className="line-clamp-2 text-sm font-semibold leading-6 text-hq-fg">{noteTitle(note) || t("editor.untitled")}</h3>{layout === "cards" ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-hq-fg-muted">{noteExcerpt(note.body)}</p> : null}{note.labels.length ? <div className="mt-3 flex flex-wrap gap-1.5">{note.labels.slice(0, 4).map((label) => <span key={label} className="rounded-md bg-hq-accent/8 px-2 py-0.5 text-[10px] font-medium text-hq-accent">{label}</span>)}</div> : null}</button>
              <div className={`flex items-center justify-between gap-2 ${layout === "cards" ? "mt-4 border-t border-hq-border/60 pt-3" : "min-w-40"}`}><div className="flex items-center gap-2 text-[10px] text-hq-fg-muted"><span className="inline-flex items-center gap-1" title={t("source.label")}><SourceIcon className="h-3 w-3" />{t(`source.${note.source}`)}</span><span title={note.shared ? t("sharing.shared") : t("editor.private")}>{note.shared ? <Share2 className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}</span>{note.members.length ? <span className="max-w-24 truncate" title={note.members.map((member) => member.name).join(", ")}>{note.members.map((member) => member.name).join(", ")}</span> : null}</div><div className="flex items-center gap-2"><time dateTime={note.updatedAt} className="whitespace-nowrap text-[10px] text-hq-fg-muted">{date(note.updatedAt)}</time>{note.isOwner && view === "inbox" ? <button type="button" disabled={!!filing} onClick={(event) => void fileNote(note, event.currentTarget)} title={t("actions.file")} aria-label={t("actions.file")} className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface hover:text-hq-success"><Check className="h-3.5 w-3.5" /></button> : null}{note.isOwner ? <button type="button" onClick={() => setModal({ kind: "share", note })} aria-label={t("actions.share")} className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface hover:text-hq-accent"><Share2 className="h-3.5 w-3.5" /></button> : null}</div></div>
              {cardErrors[note.id] ? <p role="alert" className="mt-2 w-full rounded-lg bg-hq-danger/10 p-2 text-xs text-hq-danger">{cardErrors[note.id]}</p> : null}
            </article>;
          })}
        </div>}
      </section>
    </div>
    {modal?.kind === "editor" ? <NoteEditor key={modal.note?.id ?? "new"} note={modal.note} initialBody={modal.body} roster={data.roster} onClose={closeModal} onSave={save} onShare={(note) => setModal({ kind: "share", note })} onHistory={(note) => setModal({ kind: "history", note })} /> : null}
    {modal?.kind === "share" ? <NoteShareDialog key={modal.note.id} note={modal.note} onClose={closeModal} onSaved={refresh} /> : null}
    {modal?.kind === "history" ? <NoteHistoryDialog key={modal.note.id} note={modal.note} onClose={closeModal} onRestore={save} /> : null}
  </main>;
}
