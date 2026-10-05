"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createNotesNavigation,
  type NotesDirtyState,
  type NotesNavigationStore,
} from "@/lib/notes/navigation.shared";

type DirtyNavigationValue = {
  store: NotesNavigationStore;
  url: string;
};

const Context = createContext<DirtyNavigationValue | null>(null);

export type DirtyNavigationLabels = {
  title: string;
  body: string;
  keepEditing: string;
  discard: string;
  keep?: string;
  saveFailed: string;
};

export function createBrowserDirtyNavigation(
  url: string,
  normalize: (url: string) => string,
  indexKey: string,
) {
  let pendingPop: { url: string; state: unknown } | null = null, replaying = false;
  const store = createNotesNavigation({
    url,
    commit: (target, mode, index) => {
      if (mode !== "external") window.history[mode === "push" ? "pushState" : "replaceState"]({ [indexKey]: index }, "", target);
      else if (pendingPop?.url === target) {
        const event = pendingPop; pendingPop = null; replaying = true;
        window.dispatchEvent(new PopStateEvent("popstate", { state: event.state })); replaying = false;
      }
    },
    restore: (target, from, to) => {
      pendingPop = null;
      if (from !== undefined && from !== to) window.history.go(to - from);
      else window.history.replaceState({ [indexKey]: to }, "", target);
    },
  });
  const indexOf = (state: unknown) =>
    state && typeof state === "object" && indexKey in state ? (state as Record<string, unknown>)[indexKey] as number | undefined : undefined;
  return { store, pop: (event: PopStateEvent) => {
    if (replaying) return;
    const target = normalize(`${window.location.pathname}${window.location.search}`);
    if (!store.shouldBlock(target) && !store.getSnapshot().busy) {
      store.request({ url: target, mode: "external", index: indexOf(event.state) });
      return;
    }
    event.stopImmediatePropagation();
    store.request({ url: target, mode: "external", index: indexOf(event.state) });
    if (store.getSnapshot().pending?.url === target) pendingPop = { url: target, state: event.state };
  } };
}

export function DirtyNavigation({
  children,
  normalize = (url: string) => url,
  indexKey = "__hqNotesIndex",
  labels,
}: {
  children: ReactNode;
  normalize?: (url: string) => string;
  indexKey?: string;
  labels: DirtyNavigationLabels;
}) {
  const path = usePathname(), query = useSearchParams();
  const raw = `${path}${query.size ? `?${query}` : ""}`;
  const actual = normalize(raw);
  const router = useRouter();
  const [{ store, pop }] = useState(() => createBrowserDirtyNavigation(actual, normalize, indexKey));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (snapshot.pending && !element?.open) element?.showModal();
    if (!snapshot.pending) element?.close();
  }, [snapshot.pending]);
  useEffect(() => {
    const index = indexKey in (window.history.state ?? {}) ? (window.history.state as Record<string, unknown>)[indexKey] : undefined;
    store.activate(typeof index === "number" ? index : 0);
    if (typeof index !== "number") window.history.replaceState({ [indexKey]: 0 }, "", window.location.href);
    return () => store.dispose();
  }, [store, indexKey]);
  useEffect(() => {
    const index = (window.history.state as Record<string, unknown> | null)?.[indexKey];
    if (raw !== actual && `${window.location.pathname}${window.location.search}` === raw) window.history.replaceState({ [indexKey]: store.getSnapshot().index }, "", actual + window.location.hash);
    store.request({ url: actual, mode: "external", index: typeof index === "number" ? index : undefined });
  }, [raw, actual, store, indexKey]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href, window.location.href), url = normalize(`${target.pathname}${target.search}`);
      if (target.origin !== window.location.origin || target.pathname.startsWith("/api/") || !store.shouldBlock(url)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      store.request({ url, mode: "external", action: () => router.push(url) });
    };
    window.addEventListener("popstate", pop, true); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("popstate", pop, true); document.removeEventListener("click", click, true); };
  }, [store, router, pop, normalize]);
  return <Context.Provider value={{ store, url: snapshot.url }}>{children}
    <dialog ref={dialog} aria-label={labels.title} onCancel={(event) => { event.preventDefault(); void store.resolve("cancel"); }} className="fixed inset-0 m-auto w-[min(94vw,32rem)] rounded-xl border border-hq-border bg-hq-canvas p-6 text-hq-fg shadow-xl backdrop:bg-black/60">
      <div className="space-y-4"><h2 className="text-lg font-semibold">{labels.title}</h2><p className="text-sm text-hq-fg-muted">{labels.body}</p>
        {snapshot.error ? <p role="alert" className="text-sm text-hq-danger">{snapshot.error instanceof Error ? snapshot.error.message : labels.saveFailed}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={snapshot.busy} onClick={() => { void store.resolve("cancel"); }} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{labels.keepEditing}</button>
          <button disabled={snapshot.busy} onClick={() => { void store.resolve("discard"); }} className="rounded-lg bg-hq-danger px-3 py-2 text-sm text-white">{labels.discard}</button>
          {snapshot.canKeep && labels.keep ? <button disabled={snapshot.busy} onClick={() => { void store.resolve("keep"); }} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{labels.keep}</button> : null}
        </div>
      </div>
    </dialog>
  </Context.Provider>;
}

export function useDirtyNavigation() {
  return useContext(Context);
}

export function useDirtyGuard(state: NotesDirtyState | (() => NotesDirtyState)) {
  const navigation = useContext(Context), current = useRef(state);
  useEffect(() => { current.current = state; }, [state]);
  useEffect(() => navigation?.store.register(() => {
    const latest = typeof current.current === "function" ? current.current() : current.current;
    return latest;
  }), [navigation?.store]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      const latest = typeof current.current === "function" ? current.current() : current.current;
      if (latest.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
}
