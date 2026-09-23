export type NotesDirtyState = { dirty: boolean; busy?: boolean; keys?: string[]; keep?: () => void | Promise<void>; discard?: () => void | Promise<void> };
export type NotesNavigationMode = "push" | "replace" | "external";
type Target = { url: string; mode: NotesNavigationMode; index?: number; action?: () => void };
type Snapshot = { url: string; index: number; pending: Target | null; busy: boolean; canKeep: boolean; error: unknown };

function changesContent(previous: string, next: string, keys = ["pathname", "view", "note", "draft", "task", "noteTask", "board", "import", "job", "publicationNote"]) {
  const a = new URL(previous, "https://notes.invalid"), b = new URL(next, "https://notes.invalid");
  return keys.some((key) => key === "pathname" ? a.pathname !== b.pathname : a.searchParams.get(key) !== b.searchParams.get(key));
}
export function createNotesNavigation(input: { url: string; commit: (url: string, mode: NotesNavigationMode, index: number) => void; restore: (url: string, from: number | undefined, to: number) => void }) {
  let snapshot: Snapshot = { url: input.url, index: 0, pending: null, busy: false, canKeep: false, error: null };
  let alive = true;
  const listeners = new Set<() => void>();
  const blockers = new Map<symbol, () => NotesDirtyState>();
  const update = (next: Partial<Snapshot>) => { if (alive) { snapshot = { ...snapshot, ...next }; listeners.forEach((listener) => listener()); } };
  const dirty = (target?: Target) => [...blockers.values()].map((get) => get()).filter((state) => state.dirty && (!target || target.action || changesContent(snapshot.url, target.url, state.keys)));
  const commit = (target: Target) => {
    if (!alive) return;
    const index = target.mode === "push" ? snapshot.index + 1 : target.index ?? snapshot.index;
    input.commit(target.url, target.mode, index);
    update({ url: target.url, index, pending: null, busy: false, error: null });
    target.action?.();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate: (index: number) => { alive = true; update({ index }); },
    dispose: () => { alive = false; listeners.clear(); blockers.clear(); },
    register: (get: () => NotesDirtyState) => { const id = Symbol(); blockers.set(id, get); return () => { blockers.delete(id); }; },
    shouldBlock: (url: string) => dirty({ url, mode: "external" }).length > 0,
    request: (target: Target, skip = false) => {
      if (!alive || snapshot.busy) { if (target.mode === "external") input.restore(snapshot.url, target.index, snapshot.index); return; }
      if (target.url === snapshot.url && !target.action) return;
      const blocked = skip ? [] : dirty(target);
      if (!blocked.length) { commit(target); return; }
      if (blocked.some((state) => state.busy)) { if (target.mode === "external") input.restore(snapshot.url, target.index, snapshot.index); return; }
      update({ pending: target, canKeep: blocked.every((state) => !!state.keep), error: null });
    },
    reset: () => { update({ pending: null, busy: false, error: null }); },
    resolve: async (decision: "cancel" | "discard" | "keep") => {
      const target = snapshot.pending;
      if (!target || snapshot.busy) return;
      if (decision === "cancel") {
        if (target.mode === "external") input.restore(snapshot.url, target.index, snapshot.index);
        update({ pending: null, error: null }); return;
      }
      update({ busy: true, error: null });
      try {
        for (const state of dirty(target)) {
          if (decision === "keep") { if (!state.keep) { update({ busy: false }); return; } await state.keep(); }
          else await state.discard?.();
        }
        if (snapshot.pending === target) commit(target);
      } catch (error) { update({ busy: false, error }); }
    },
  };
}
export type NotesNavigationStore = ReturnType<typeof createNotesNavigation>;
