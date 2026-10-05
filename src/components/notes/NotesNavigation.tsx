"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NotesDirtyState } from "@/lib/notes/navigation.shared";
import { notesWorkspaceLocation, scopedWorkspaceLocation, type NoteWorkspaceState } from "@/lib/notes/workspace.shared";
import { DirtyNavigation, useDirtyNavigation } from "@/components/navigation/DirtyNavigation";
import type { NotesNavigationStore } from "@/lib/notes/navigation.shared";

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

function NotesNavigationContext({ children, scope, normalize }: { children: ReactNode; scope: string; normalize: (url: string) => string }) {
  const dirty = useDirtyNavigation();
  const store = dirty?.store ?? null;
  const subscribe = useCallback((listener: () => void) => store ? store.subscribe(listener) : () => {}, [store]);
  const snapshot = useSyncExternalStore(subscribe, () => store?.getSnapshot() ?? null, () => null);
  if (!store || !snapshot) throw new Error("missing_notes_navigation");
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
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function NotesNavigation({ children, scope, defaults }: { children: ReactNode; scope: string; defaults: NoteWorkspaceState }) {
  const t = useTranslations("notes");
  const normalize = useCallback((url: string) => scopedWorkspaceLocation(url, defaults, scope), [defaults, scope]);
  return (
    <DirtyNavigation
      normalize={normalize}
      labels={{
        title: t("editor.discardTitle"),
        body: t("editor.discardBody"),
        keepEditing: t("editor.keepEditing"),
        discard: t("editor.discard"),
        keep: t("drafts.keepClose"),
        saveFailed: t("saveFailed"),
      }}
    >
      <NotesNavigationContext scope={scope} normalize={normalize}>{children}</NotesNavigationContext>
    </DirtyNavigation>
  );
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
