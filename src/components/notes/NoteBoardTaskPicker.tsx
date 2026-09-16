"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { NoteBoardSnapshot } from "@/lib/notes/board.shared";
import type { NoteTask, NoteTaskSummary } from "@/lib/notes/tasks.shared";
import { NoteMarkdown } from "./NoteMarkdown";
import { useNotesFetch, useNotesNavigation } from "./NotesNavigation";

export function NoteBoardTaskPicker({ board, pending, onShare, onClose }: { board: Pick<NoteBoardSnapshot, "id"> & { tasks: Array<{ id: string }> }; pending: boolean; onShare: (task: NoteTask) => Promise<void>; onClose: () => void }) {
  const t = useTranslations("notes"), fetchNotes = useNotesFetch(), navigation = useNotesNavigation();
  const [cursor, setCursor] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<{ tasks: NoteTaskSummary[]; cursor: string | null; nextCursor: string | null; previousCursor: string | null } | null>(null);
  const [selected, setSelected] = useState(""), [detail, setDetail] = useState<NoteTask | null>(null), [error, setError] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ format: "summary", personalOnly: "1", status: "all", ...(cursor ? { cursor } : {}) });
    void fetchNotes(`/api/notes/tasks?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body.scope !== navigation.scope) throw new Error(body.error ?? t("loadFailed"));
      if (!controller.signal.aborted) { setPage({ ...body, cursor }); setError(null); }
    }).catch((failure) => { if (!controller.signal.aborted) { setPage(null); setDetail(null); setError(failure instanceof Error ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [cursor, retry, fetchNotes, navigation.scope, t]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetchNotes(`/api/notes/tasks/${encodeURIComponent(selected)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.task?.isOwner || body.task.archived) throw new Error(body.error ?? t("notFound"));
      if (!controller.signal.aborted) { setDetail(body.task); setError(null); }
    }).catch((failure) => { if (!controller.signal.aborted) { setDetail(null); setError(failure instanceof Error ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [selected, retry, fetchNotes, t]);
  useEffect(() => { if (error) anchor.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const current = page?.cursor === cursor ? page : null;
  const choices = current?.tasks.filter((task) => task.isOwner && !board.tasks.some((item) => item.id === task.id)) ?? [];
  const task = detail?.id === selected && !board.tasks.some((item) => item.id === detail.id) ? detail : null;
  const button = "rounded border border-hq-border px-3 py-2 text-xs disabled:opacity-40";
  return <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4" data-testid="board-task-picker">
    <select aria-label={t("boards.chooseTask")} value={selected} disabled={pending || !current} onChange={(event) => { setSelected(event.target.value); setDetail(null); }} className="w-full rounded border border-hq-border bg-hq-canvas p-2"><option value="">{t("boards.chooseTask")}</option>{task && !choices.some((item) => item.id === task.id) && <option value={task.id}>{task.title}</option>}{choices.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
    <div className="flex gap-2"><button type="button" className={button} disabled={pending || !current?.previousCursor} onClick={() => setCursor(current?.previousCursor ?? null)}>{t("imports.previous")}</button><button type="button" className={button} disabled={pending || !current?.nextCursor} onClick={() => setCursor(current?.nextCursor ?? null)}>{t("imports.next")}</button></div>
    {task && <div><h3 className="font-semibold">{task.title}</h3>{task.description && <NoteMarkdown body={task.description} />}</div>}
    <p className="text-xs">{t("boards.audienceHint")}</p>
    <div ref={anchor}>{error && <><p role="alert" className="text-sm text-hq-danger">{error}</p><button type="button" className={button} disabled={pending} onClick={() => setRetry((value) => value + 1)}>{t("workspace.retryLoading")}</button></>}</div>
    <div className="flex gap-3"><button type="button" disabled={!task || pending} onClick={() => { if (task) void onShare(task).then(onClose).catch((failure) => setError(failure instanceof Error ? failure.message : t("saveFailed"))); }} className="rounded bg-hq-accent p-2 text-sm text-white disabled:opacity-50">{t("boards.confirmShare")}</button><button type="button" disabled={pending} onClick={onClose}>{t("actions.close")}</button></div>
  </section>;
}
