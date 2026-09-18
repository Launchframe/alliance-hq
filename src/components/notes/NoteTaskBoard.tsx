"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNotesSearchParams, useNotesNavigation, useNotesFetch, useNotesDirtyState } from "./NotesNavigation";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, Share2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useVersionedSnapshot } from "@/components/member-board/useVersionedSnapshot";
import { Dialog } from "@/components/ui/dialog";
import { notesBoardTransport } from "@/lib/notes/live-transport.shared";
import type { NoteBoardViewSnapshot } from "@/lib/notes/board.shared";
import { TASK_STATUSES, type NoteTask, type NoteTaskSummary, type TaskCreate, type TaskPatch, type TaskStatus } from "@/lib/notes/tasks.shared";
import { formatAccountDate } from "@/lib/timezone/format";
import { TaskStateFields } from "./TaskStateFields";
import { NoteTaskEditor } from "./NoteTaskEditor";
import { NoteBoardTaskPicker } from "./NoteBoardTaskPicker";

const MIME = "application/x-hq-note-task";
export function NoteTaskBoard({ initial, onRevoked }: { initial: NoteBoardViewSnapshot; onRevoked: () => void }) {
  const t = useTranslations("notes"), common = useTranslations("common");
  const locale = useLocale();
  const params = useNotesSearchParams(), navigation = useNotesNavigation(), fetchNotes = useNotesFetch();
  const transport = useMemo(() => notesBoardTransport({ id: initial.id, allianceId: initial.allianceId, principalId: initial.principalId }), [initial.id, initial.allianceId, initial.principalId]);
  const live = useVersionedSnapshot({ scope: `${initial.allianceId}:${initial.id}`, identity: initial.principalId, initial, transport });
  const board = live.snapshot;
  const group = ["none", "assignee", "team"].includes(params.get("boardGroup") ?? "") ? params.get("boardGroup")! : "none";
  const layout = params.get("boardLayout") === "list" ? "list" : "board";
  const closed = params.get("boardClosed") === "1", label = params.get("boardLabel") ?? "";
  const editing: NoteTaskSummary | "new" | null = params.get("task") === "new" ? board?.canWrite ? "new" : null : board?.tasks.find((task) => task.id === params.get("task")) ?? null;
  const openTask = useCallback((task: NoteTaskSummary | "new" | null) => {
    navigation.change({ task: task === "new" ? "new" : task?.id ?? null }, task === null, task === null);
  }, [navigation]);
  function changeView(changes: { boardGroup?: string; boardLayout?: string; boardClosed?: string }) { navigation.change(changes); }
  const [renaming, setRenaming] = useState<{ name: string; version: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState<{ task: NoteTaskSummary; version: number } | null>(null);
  const [detail, setDetail] = useState<NoteTask | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null), [detailRetry, setDetailRetry] = useState(0);
  const detailErrorAnchor = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (detailError) detailErrorAnchor.current?.scrollIntoView({ block: "nearest" }); }, [detailError]);
  const detailId = editing && editing !== "new" ? editing.id : null, lastDetail = useRef(detailId);
  useEffect(() => navigation.store.subscribe(() => {
    const next = new URL(navigation.store.getSnapshot().url, window.location.origin).searchParams.get("task");
    if (next !== lastDetail.current) { lastDetail.current = next; setDetail(null); setDetailError(null); }
  }), [navigation.store]);
  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    void fetchNotes(`/api/notes/tasks/${encodeURIComponent(detailId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const value = await response.json().catch(() => null);
      if (!response.ok || value?.task?.id !== detailId) throw new Error(value?.error ?? t("loadFailed"));
      if (!controller.signal.aborted) { setDetail(value.task); setDetailError(null); }
    }).catch((failure) => { if (!controller.signal.aborted) { setDetail(null); setDetailError(failure instanceof Error && !(failure instanceof TypeError) ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [detailId, detailRetry, fetchNotes, t]);
  useNotesDirtyState({ dirty: !!renaming && renaming.name !== board?.name, busy: pending, keys: ["pathname", "view", "board"], discard: () => setRenaming(null) });
  useEffect(() => { if (live.revoked) onRevoked(); }, [live.revoked, onRevoked]);
  const hotkeys = useMemo(() => ({ "notes.newTask": () => { if (board?.canWrite) openTask("new"); } }), [board?.canWrite, openTask]);
  useRegisterPageHotkeys(hotkeys, !editing && !renaming && !sharing && !removing && !live.revoked);
  if (!board || live.revoked) return <p role="alert" className="p-6 text-hq-danger">{t("errors.forbidden")}</p>;
  const currentBoard = board;
  async function command(values: Record<string, unknown>, version = currentBoard.version, key = "board") {
    setPending(true); setErrors((current) => ({ ...current, [key]: "" }));
    try {
      const response = await fetchNotes(`/api/notes/boards/${currentBoard.id}/commands?format=summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, expectedVersion: version, requestId: typeof values.requestId === "string" ? values.requestId : crypto.randomUUID() }) });
      const payload = await response.json();
      if (!response.ok) { if (response.status === 409) await live.refresh(payload.snapshot?.version); throw new Error(payload.code === "changed" ? t("boards.changed") : payload.error ?? t("saveFailed")); }
      await live.refresh(payload.version);
    } catch (failure) { const message = failure instanceof Error ? failure.message : t("saveFailed"); setErrors((current) => ({ ...current, [key]: message })); throw failure; }
    finally { setPending(false); }
  }
  async function saveTask(input: TaskCreate | TaskPatch, id?: string) {
    if (!id) await command({ kind: "create", task: input, requestId: input.requestId });
    else {
      const response = await fetchNotes(`/api/notes/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.code === "changed" ? t("boards.changed") : payload.error ?? t("saveFailed"));
      await live.refresh();
    }
    openTask(null);
  }
  function move(task: NoteTaskSummary, status: TaskStatus, beforeTaskId: string | null = null, version = currentBoard.version) {
    void command({ kind: "move", taskId: task.id, expectedTaskVersion: task.version, status, beforeTaskId }, version, task.id).catch(() => undefined);
  }
  function drop(event: DragEvent, status: TaskStatus, beforeTaskId: string | null = null) {
    event.preventDefault(); event.stopPropagation();
    try {
      const value = JSON.parse(event.dataTransfer.getData(MIME));
      const task = currentBoard.tasks.find((task) => task.id === value.taskId);
      if (!task || !task.canEdit || !currentBoard.canWrite || value.boardId !== currentBoard.id || value.principalId !== currentBoard.principalId || value.allianceId !== currentBoard.allianceId || value.version !== currentBoard.version || value.taskVersion !== task.version) { setErrors((current) => ({ ...current, board: t("boards.changed") })); return; }
      move(task, status, beforeTaskId, value.version);
    } catch { setErrors((current) => ({ ...current, board: t("boards.changed") })); }
  }
  const visible = board.tasks.filter((task) => (!label || task.labels.includes(label)) && (closed || !task.archived && task.status !== "cancelled"));
  const labels = [...new Set([...board.tasks.flatMap((task) => task.labels), ...(label ? [label] : [])])].sort((a, b) => a.localeCompare(b, locale));
  const groupId = (task: NoteBoardViewSnapshot["tasks"][number]) => group === "assignee" ? task.assignee?.id ?? "unassigned" : group === "team" ? task.teamId ?? "unassigned" : "all";
  const groups = [...new Set(visible.map(groupId))];
  if (!groups.length) groups.push("all");
  const states = closed ? TASK_STATUSES : TASK_STATUSES.filter((status) => status !== "cancelled");
  const currentEditing = editing && editing !== "new" ? board.tasks.find((task) => task.id === editing.id) : null;
  return <section data-testid="notes-shared-board" data-board-version={board.version} className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold" data-testid="notes-board-name">{board.name}</h2><span className={`text-xs ${live.connected ? "text-hq-success" : "text-hq-fg-muted"}`} role="status">{t(live.connected ? "boards.live" : "boards.reconnecting")}</span></div>{board.canWrite ? <div className="flex flex-wrap gap-2"><button onClick={() => setRenaming({ name: board.name, version: board.version })} className="rounded-lg border border-hq-border px-3 py-2 text-xs">{t("boards.rename")}</button><button onClick={() => setSharing(true)} className="flex items-center gap-2 rounded-lg border border-hq-border px-3 py-2 text-xs"><Share2 className="h-3 w-3" />{t("boards.shareTask")}</button><button onClick={() => openTask("new")} className="flex items-center gap-2 rounded-lg bg-hq-accent px-3 py-2 text-xs text-white"><Plus className="h-3 w-3" />{t("tasks.new")}</button></div> : null}</header>
    <p className="text-xs text-hq-fg-muted">{t("boards.audienceHint")}</p>
    {errors.board || live.error ? <p role="alert" className="rounded bg-hq-danger/10 p-3 text-sm text-hq-danger">{errors.board || t("loadFailed")}</p> : null}
    {renaming ? <form onSubmit={(event) => { event.preventDefault(); void command({ kind: "rename", name: renaming.name }, renaming.version).then(() => setRenaming(null)).catch(() => undefined); }} className="flex flex-wrap gap-2"><input aria-label={t("boards.name")} value={renaming.name} maxLength={100} onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} className="rounded-lg border border-hq-border bg-hq-canvas p-2 text-sm" /><button disabled={pending || !renaming.name.trim()} className="rounded-lg bg-hq-accent px-3 text-white">{t("boards.saveName")}</button><button type="button" onClick={() => setRenaming(null)}>{t("actions.close")}</button></form> : null}
    {sharing && <NoteBoardTaskPicker board={board} pending={pending} onClose={() => setSharing(false)} onShare={(task) => command({ kind: "share", taskId: task.id, expectedTaskVersion: task.version })} />}
    <div className="flex flex-wrap items-center gap-3 text-xs"><select aria-label={t("boards.groupBy")} value={group} onChange={(event) => changeView({ boardGroup: event.target.value })} className="rounded-lg border border-hq-border bg-hq-canvas p-2"><option value="none">{t("boards.noGrouping")}</option><option value="assignee">{t("tasks.assignee")}</option><option value="team">{t("boards.byTeam")}</option></select><select aria-label={t("boards.layout")} value={layout} onChange={(event) => changeView({ boardLayout: event.target.value })} className="rounded-lg border border-hq-border bg-hq-canvas p-2"><option value="board">{t("boards.board")}</option><option value="list">{t("boards.list")}</option></select><label className="flex items-center gap-2"><input type="checkbox" checked={closed} onChange={(event) => changeView({ boardClosed: event.target.checked ? "1" : "0" })} />{t("boards.includeClosed")}</label><select aria-label={t("fields.labels")} value={label} onChange={(event) => navigation.change({ boardLabel: event.target.value })} className="rounded-lg border border-hq-border bg-hq-canvas p-2"><option value="">{t("fields.labels")}</option>{labels.map((value) => <option key={value} value={value}>{value}</option>)}</select>{label && <button type="button" onClick={() => navigation.change({ boardLabel: "" })} className="rounded border border-hq-border p-2">{t("workspace.clearFilters")}</button>}</div>
    <div className="space-y-5">{groups.map((id) => <div key={id} className="space-y-2">{id !== "all" ? <h3 className="text-sm font-semibold">{group === "team" ? board.teams.find((team) => team.id === id)?.name ?? t("tasks.unassigned") : board.people.find((person) => person.id === id)?.name ?? t("tasks.unassigned")}</h3> : null}<div className={layout === "board" ? closed ? "grid gap-3 lg:grid-cols-4" : "grid gap-3 lg:grid-cols-3" : "space-y-3"}>{states.map((status) => {
      const cards = visible.filter((task) => groupId(task) === id && task.status === status);
      return <section key={status} aria-label={t(`tasks.status.${status}`)} onDragOver={(event) => { if (board.canWrite && event.dataTransfer.types.includes(MIME)) event.preventDefault(); }} onDrop={(event) => drop(event, status)} className="min-h-24 rounded-xl border border-hq-border bg-hq-surface/60 p-3"><h4 className="mb-3 text-xs font-semibold">{t(`tasks.status.${status}`)} <span className="opacity-60">{cards.length.toLocaleString(locale)}</span></h4><div className="space-y-3">{cards.map((task, index) => <article key={task.id} data-testid="board-task" data-task-id={task.id} draggable={board.canWrite && task.canEdit && !pending} onDragStart={(event) => event.dataTransfer.setData(MIME, JSON.stringify({ boardId: board.id, principalId: board.principalId, allianceId: board.allianceId, version: board.version, taskId: task.id, taskVersion: task.version }))} onDragOver={(event) => { if (board.canWrite && event.dataTransfer.types.includes(MIME)) event.preventDefault(); }} onDrop={(event) => drop(event, status, task.id)} className="space-y-3 rounded-lg border border-hq-border bg-hq-canvas p-3 shadow-sm">
        <button onClick={() => openTask(task)} className="w-full text-left text-sm font-semibold">{task.title}</button>{task.excerpt ? <p className="line-clamp-2 text-xs text-hq-fg-muted">{task.excerpt}</p> : null}
        <div className="flex flex-wrap gap-2">{task.labels.map((value) => <button type="button" key={value} onClick={() => navigation.change({ boardLabel: value })} className="rounded bg-hq-accent/10 px-2 py-1 text-xs text-hq-accent">{value}</button>)}</div>
        <TaskStateFields status={task.status} priority={task.priority} disabled={!board.canWrite || !task.canEdit || pending} onStatus={(next) => move(task, next)} onPriority={(priority) => { void saveTask({ expectedVersion: task.version, priority }, task.id).catch((failure) => setErrors((current) => ({ ...current, [task.id]: failure.message }))); }} />
        <div className="space-y-1 text-xs text-hq-fg-muted">{task.assignee ? <p>{task.assignee.name ?? t("sharing.unnamedMember")}</p> : null}{task.dueAt ? <time dateTime={task.dueAt}>{formatAccountDate(task.dueAt, { locale, timezoneId: "server", dateStyle: "medium" })}</time> : null}{task.source ? <Link href={`/notes/${task.source.id}`} className="block text-hq-accent">{task.source.title}</Link> : null}</div>
        {board.canWrite ? <div className="flex items-center justify-between gap-2"><div className="flex gap-1"><button disabled={!index || pending} aria-label={t("boards.moveUp", { title: task.title })} onClick={() => move(task, status, cards[index - 1]?.id ?? null)} className="p-1 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button><button disabled={index === cards.length - 1 || pending} aria-label={t("boards.moveDown", { title: task.title })} onClick={() => move(task, status, cards[index + 2]?.id ?? null)} className="p-1 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button></div>{task.isOwner ? <button disabled={pending} onClick={() => setRemoving({ task, version: board.version })} className="text-xs text-hq-fg-muted">{t("boards.removeTask")}</button> : null}</div> : null}
        {errors[task.id] ? <p role="alert" className="text-xs text-hq-danger">{errors[task.id]}</p> : null}
      </article>)}</div></section>;
    })}</div></div>)}</div>
    {removing ? <Dialog open title={t("boards.removeTask")} ignoreOutsideDismiss={pending} onOpenChange={(open) => { if (!open && !pending) setRemoving(null); }}><div className="space-y-4 p-5"><h2 className="font-semibold">{removing.task.title}</h2><p className="text-sm">{t("boards.removeConfirm")}</p>{errors[removing.task.id] ? <p role="alert" className="text-sm text-hq-danger">{errors[removing.task.id]}</p> : null}<div className="flex justify-end gap-3"><button disabled={pending} onClick={() => setRemoving(null)}>{t("actions.close")}</button><button disabled={pending} onClick={() => void command({ kind: "remove", taskId: removing.task.id, expectedTaskVersion: removing.task.version }, removing.version, removing.task.id).then(() => setRemoving(null)).catch(() => undefined)} className="rounded bg-hq-accent px-3 py-2 text-sm text-white">{t("boards.removeTask")}</button></div></div></Dialog> : null}
    {currentEditing && detail?.id !== currentEditing.id && <Dialog open title={currentEditing.title} onOpenChange={(open) => { if (!open) openTask(null); }}><div className="space-y-4 p-5">{detailError ? <><p ref={detailErrorAnchor} role="alert" className="text-sm text-hq-danger">{detailError}</p><button type="button" className="rounded-lg border border-hq-border px-3 py-2 text-sm" onClick={() => { setDetailError(null); setDetailRetry((version) => version + 1); }}>{t("workspace.retryLoading")}</button></> : <p role="status" className="text-sm text-hq-fg-muted">{common("loading")}</p>}<button type="button" onClick={() => openTask(null)} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("actions.close")}</button></div></Dialog>}
    {editing === "new" || currentEditing && detail?.id === currentEditing.id ? <NoteTaskEditor key={editing === "new" ? "new" : currentEditing!.id} task={editing === "new" ? null : { ...detail!, canEdit: currentEditing!.canEdit && board.canWrite, isOwner: currentEditing!.isOwner, source: currentEditing!.source }} boardName={board.name} people={board.people} onClose={() => openTask(null)} onSave={saveTask} /> : null}
  </section>;
}
