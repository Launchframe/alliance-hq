"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  clampHqRatio,
  DEFAULT_HYBRID_ASHED_LAYOUT,
  hybridAshedLayoutStorageKey,
  parseHybridAshedLayoutPrefs,
  serializeHybridAshedLayoutPrefs,
  type HybridAshedLayoutPrefs,
  type HybridMobilePane,
} from "@/lib/nav/hybrid-ashed-layout.shared";

type PrefsCacheEntry = {
  raw: string;
  prefs: HybridAshedLayoutPrefs;
};

const prefsCaches = new Map<string, PrefsCacheEntry>();
const prefsListeners = new Set<() => void>();

function readHybridPrefs(storageKey: string): HybridAshedLayoutPrefs {
  if (typeof window === "undefined") {
    return DEFAULT_HYBRID_ASHED_LAYOUT;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    const rawNorm = raw ?? "";
    const cached = prefsCaches.get(storageKey);
    if (cached && cached.raw === rawNorm) {
      return cached.prefs;
    }

    const prefs = raw
      ? parseHybridAshedLayoutPrefs(JSON.parse(raw))
      : DEFAULT_HYBRID_ASHED_LAYOUT;

    prefsCaches.set(storageKey, { raw: rawNorm, prefs });
    return prefs;
  } catch {
    prefsCaches.set(storageKey, { raw: "", prefs: DEFAULT_HYBRID_ASHED_LAYOUT });
    return DEFAULT_HYBRID_ASHED_LAYOUT;
  }
}

function writeHybridPrefs(storageKey: string, next: HybridAshedLayoutPrefs): void {
  const serialized = serializeHybridAshedLayoutPrefs(next);
  prefsCaches.set(storageKey, { raw: serialized, prefs: next });
  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    // ignore quota / privacy-mode write failures
  }
  for (const listener of prefsListeners) {
    listener();
  }
}

function subscribeHybridPrefs(onChange: () => void): () => void {
  prefsListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("alliance-hq-hybrid-ashed-")) {
      prefsCaches.delete(event.key);
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefsListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHybridAshedLayout(pageId: string) {
  const storageKey = hybridAshedLayoutStorageKey(pageId);

  const getSnapshot = useCallback((): HybridAshedLayoutPrefs => {
    return readHybridPrefs(storageKey);
  }, [storageKey]);

  const prefs = useSyncExternalStore(
    subscribeHybridPrefs,
    getSnapshot,
    () => DEFAULT_HYBRID_ASHED_LAYOUT,
  );

  const write = useCallback(
    (next: HybridAshedLayoutPrefs) => {
      writeHybridPrefs(storageKey, next);
    },
    [storageKey],
  );

  const setMobilePane = useCallback(
    (activePane: HybridMobilePane) => {
      write({ ...prefs, mobile: { activePane } });
    },
    [prefs, write],
  );

  const setHqRatio = useCallback(
    (hqRatio: number) => {
      const current = readHybridPrefs(storageKey);
      write({
        ...current,
        desktop: { ...current.desktop, hqRatio: clampHqRatio(hqRatio) },
      });
    },
    [storageKey, write],
  );

  const setHqCollapsed = useCallback(
    (hqCollapsed: boolean) => {
      write({
        ...prefs,
        desktop: {
          ...prefs.desktop,
          hqCollapsed,
          ashedCollapsed: hqCollapsed ? prefs.desktop.ashedCollapsed : false,
        },
      });
    },
    [prefs, write],
  );

  const setAshedCollapsed = useCallback(
    (ashedCollapsed: boolean) => {
      write({
        ...prefs,
        desktop: {
          ...prefs.desktop,
          ashedCollapsed,
          hqCollapsed: ashedCollapsed ? prefs.desktop.hqCollapsed : false,
        },
      });
    },
    [prefs, write],
  );

  return {
    prefs,
    setMobilePane,
    setHqRatio,
    setHqCollapsed,
    setAshedCollapsed,
  };
}
