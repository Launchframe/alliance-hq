"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createNotesNavigation, type NotesDirtyState, type NotesNavigationStore } from "@/lib/notes/navigation.shared";
import { notesWorkspaceLocation, scopedWorkspaceLocation, type NoteWorkspaceState } from "@/lib/notes/workspace.shared";

type Navigation = {
  scope: string;
  store: NotesNavigationStore;
  pathname: string;
  params: URLSearchParams;
  go: (url: string, replace?: boolean, skip?: boolean) => void;
  change: (values: Record<string, string | null>, replace?: boolean, skip?: boolean) => void;
  run: (action: () => void, skip?: boolean) => void;
};
const Context = createContext<Navigation | null>(null);
function createBrowserNavigation(url: string, normalize: (url: string) => string) {
  let pendingPop: { url: string; state: unknown } | null = null, replaying = false;
  const store = createNotesNavigation({
    url,
    commit: (target, mode, index) => {
      if (mode !== "external") window.history[mode === "push" ? "pushState" : "replaceState"]({ __hqNotesIndex: index }, "", target);
      else if (pendingPop?.url === target) {
        const event = pendingPop; pendingPop = null; replaying = true;
        window.dispatchEvent(new PopStateEvent("popstate", { state: event.state })); replaying = false;
      }
    },
    restore: (target, from, to) => {
      pendingPop = null;
      if (from !== undefined && from !== to) window.history.go(to - from);
      else window.history.replaceState({ __hqNotesIndex: to }, "", target);
    },
  });
  return { store, pop: (event: PopStateEvent) => {
    if (replaying) return;
    const target = normalize(`${window.location.pathname}${window.location.search}`);
    if (!store.shouldBlock(target) && !store.getSnapshot().busy) return;
    event.stopImmediatePropagation();
    store.request({ url: target, mode: "external", index: event.state?.__hqNotesIndex });
    if (store.getSnapshot().pending?.url === target) pendingPop = { url: target, state: event.state };
  } };
}
export function NotesNavigation({ children, scope, defaults, initialCursor }: { children: ReactNode; scope: string; defaults: NoteWorkspaceState; initialCursor?: string | null }) {
  const path = usePathname(), query = useSearchParams(), t = useTranslations("notes");
  const raw = `${path}${query.size ? `?${query}` : ""}`;
  const [initialUrl] = useState(raw);
  const normalize = useCallback((url: string) => {
    const normalized = scopedWorkspaceLocation(url, defaults, scope);
    if (url !== initialUrl || initialCursor !== null) return normalized;
    const safe = new URL(normalized, "https://notes.invalid");
    safe.searchParams.delete("cursor");
    return `${safe.pathname}${safe.search}${safe.hash}`;
  }, [defaults, scope, initialCursor, initialUrl]);
  const actual = normalize(raw);
  const router = useRouter();
  const [{ store, pop }] = useState(() => createBrowserNavigation(actual, normalize));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (snapshot.pending && !element?.open) element?.showModal();
    if (!snapshot.pending) element?.close();
  }, [snapshot.pending]);
  useEffect(() => {
    const index = window.history.state?.__hqNotesIndex;
    store.activate(typeof index === "number" ? index : 0);
    if (typeof index !== "number") window.history.replaceState({ __hqNotesIndex: 0 }, "", window.location.href);
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    if (raw !== actual && `${window.location.pathname}${window.location.search}` === raw) window.history.replaceState({ __hqNotesIndex: store.getSnapshot().index }, "", actual + window.location.hash);
    store.request({ url: actual, mode: "external", index: window.history.state?.__hqNotesIndex });
  }, [raw, actual, store]);
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
  const value = useMemo<Navigation>(() => {
    const url = new URL(snapshot.url, "https://notes.invalid");
    const go = (target: string, replace = false, skip = false) => {
      if (!target.startsWith("/") || target.startsWith("//")) throw new Error("invalid_notes_navigation");
      store.request({ url: normalize(target), mode: replace ? "replace" : "push" }, skip);
    };
    return { scope, store, pathname: url.pathname, params: url.searchParams, go,
      change: (values, replace, skip) => go(notesWorkspaceLocation(url.pathname, url.search, values), replace, skip),
      run: (action, skip) => store.request({ url: snapshot.url, mode: "replace", action }, skip),
    };
  }, [snapshot.url, scope, store, normalize]);
  return <Context.Provider value={value}>{children}
    <dialog ref={dialog} aria-label={t("editor.discardTitle")} onCancel={(event) => { event.preventDefault(); void store.resolve("cancel"); }} className="fixed inset-0 m-auto w-[min(94vw,32rem)] rounded-xl border border-hq-border bg-hq-canvas p-6 text-hq-fg shadow-xl backdrop:bg-black/60">
      <div className="space-y-4"><h2 className="text-lg font-semibold">{t("editor.discardTitle")}</h2><p className="text-sm text-hq-fg-muted">{t("editor.discardBody")}</p>
        {snapshot.error ? <p role="alert" className="text-sm text-hq-danger">{t("saveFailed")}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={snapshot.busy} onClick={() => { void store.resolve("cancel"); }} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("editor.keepEditing")}</button>
          <button disabled={snapshot.busy} onClick={() => { void store.resolve("discard"); }} className="rounded-lg bg-hq-danger px-3 py-2 text-sm text-white">{t("editor.discard")}</button>
          {snapshot.canKeep && <button disabled={snapshot.busy} onClick={() => { void store.resolve("keep"); }} className="rounded-lg border border-hq-border px-3 py-2 text-sm">{t("drafts.keepClose")}</button>}
        </div>
      </div>
    </dialog>
  </Context.Provider>;
}
export function useNotesNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error("missing_notes_navigation");
  return value;
}
export function useOptionalNotesNavigation() { return useContext(Context); }
export function useNotesSearchParams() {
  const native = useSearchParams(), value = useContext(Context);
  return value?.params ?? native;
}
export function useNotesFetch() {
  const scope = useContext(Context)?.scope;
  return useCallback((input: RequestInfo | URL, init?: RequestInit) => {
    if (!scope || typeof input !== "string" || !/^\/api\/notes(?:[/?]|$)/.test(input)) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("X-Notes-Scope", scope);
    return fetch(input, { ...init, headers });
  }, [scope]);
}
export function useNotesDirtyState(state: NotesDirtyState | (() => NotesDirtyState)) {
  const navigation = useContext(Context), current = useRef(state);
  useEffect(() => { current.current = state; }, [state]);
  useEffect(() => navigation?.store.register(() => {
    const latest = typeof current.current === "function" ? current.current() : current.current;
    return { ...latest, keep: latest.keep ? async () => { await latest.keep!(); window.dispatchEvent(new Event("notes-workspace-refresh")); } : undefined };
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
