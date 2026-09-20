"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRegisterPageHotkeys } from "@/components/hotkeys/HotkeyProvider";
import { useTranslations } from "next-intl";
import { useNotesSearchParams, useNotesNavigation, useNotesFetch, useNotesDirtyState } from "./NotesNavigation";
import type { NoteBoardSnapshot, NoteBoardSummary } from "@/lib/notes/board.shared";
import { NoteTaskBoard } from "./NoteTaskBoard";

export function NoteBoardsClient() {
  const t = useTranslations("notes");
  const params = useNotesSearchParams(), navigation = useNotesNavigation(), fetchNotes = useNotesFetch();
  const [boards, setBoards] = useState<NoteBoardSummary[]>([]);
  const selected = params.get("board") ?? "";
  const [snapshot, setSnapshot] = useState<NoteBoardSnapshot | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  useNotesDirtyState({ dirty: creating && !!name.trim(), busy: pending, keys: ["pathname", "view"], discard: () => { setCreating(false); setName(""); } });
  const revoke = useCallback(() => { setSnapshot(null); setBoards([]); setCanWrite(false); navigation.store.reset(); navigation.change({ board: null, task: null }, true, true); setError(t("errors.forbidden")); }, [t, navigation]);
  const hotkeys = useMemo(() => ({ "notes.newBoard": () => { if (canWrite) setCreating(true); } }), [canWrite]);
  useRegisterPageHotkeys(hotkeys, !creating);
  useEffect(() => {
    const controller = new AbortController();
    void fetchNotes("/api/notes/boards", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("loadFailed"));
      if (!controller.signal.aborted) { setBoards(data.boards); setCanWrite(data.canWrite); }
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("loadFailed")); });
    return () => controller.abort();
  }, [t, fetchNotes]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void fetchNotes(`/api/notes/boards/${selected}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("loadFailed"));
      if (!controller.signal.aborted) setSnapshot(data);
    }).catch((failure) => { if (!controller.signal.aborted) { setSnapshot(null); setError(failure instanceof Error ? failure.message : t("loadFailed")); } });
    return () => controller.abort();
  }, [selected, t, fetchNotes]);
  function select(id: string, committed = false) {
    setError(null);
    navigation.change({ view: "boards", board: id || null, task: null }, false, committed);
  }
  async function create() {
    if (pending || !name.trim()) return;
    setPending(true); setError(null);
    try {
      const response = await fetchNotes("/api/notes/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, requestId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("saveFailed"));
      setBoards((current) => [...current, { id: data.boardId, name, version: data.version }]);
      setCreating(false); setName(""); setRequestId(crypto.randomUUID()); select(data.boardId, true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("saveFailed")); }
    finally { setPending(false); }
  }
  return <div className="min-w-0 flex-1 space-y-5 p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><select aria-label={t("boards.selector")} value={selected} onChange={(event) => select(event.target.value)} className="min-w-48 rounded-lg border border-hq-border bg-hq-canvas p-2 text-sm"><option value="">{t("boards.selector")}</option>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>{canWrite ? <button onClick={() => setCreating(true)} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("boards.new")}</button> : null}</div>
    {error ? <p role="alert" className="text-sm text-hq-danger">{error}</p> : null}
    {creating ? <form onSubmit={(event) => { event.preventDefault(); void create(); }} className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-4"><label className="block space-y-2 text-sm"><span>{t("boards.name")}</span><input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="block w-full rounded border border-hq-border bg-hq-canvas p-2" /></label><p className="text-xs">{t("boards.audienceHint")}</p><button disabled={pending || !name.trim()} className="rounded bg-hq-accent px-3 py-2 text-sm text-white disabled:opacity-50">{t("boards.create")}</button><button type="button" onClick={() => setCreating(false)} className="ml-3 text-sm">{t("actions.close")}</button></form> : null}
    {snapshot && snapshot.id === selected ? <NoteTaskBoard key={`${snapshot.allianceId}:${snapshot.id}:${snapshot.principalId}`} initial={snapshot} onRevoked={revoke} /> : !selected ? <p className="rounded-xl border border-dashed border-hq-border p-8 text-sm text-hq-fg-muted">{t("boards.empty")}</p> : null}
  </div>;
}
