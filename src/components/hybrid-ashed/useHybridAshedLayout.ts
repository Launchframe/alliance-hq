"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  DEFAULT_HYBRID_ASHED_LAYOUT,
  hybridAshedLayoutStorageKey,
  parseHybridAshedLayoutPrefs,
  serializeHybridAshedLayoutPrefs,
  type HybridAshedLayoutPrefs,
  type HybridMobilePane,
} from "@/lib/nav/hybrid-ashed-layout.shared";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function useHybridAshedLayout(pageId: string) {
  const storageKey = hybridAshedLayoutStorageKey(pageId);

  const getSnapshot = useCallback((): HybridAshedLayoutPrefs => {
    if (typeof window === "undefined") {
      return DEFAULT_HYBRID_ASHED_LAYOUT;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return DEFAULT_HYBRID_ASHED_LAYOUT;
      return parseHybridAshedLayoutPrefs(JSON.parse(raw));
    } catch {
      return DEFAULT_HYBRID_ASHED_LAYOUT;
    }
  }, [storageKey]);

  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_HYBRID_ASHED_LAYOUT);

  const write = useCallback(
    (next: HybridAshedLayoutPrefs) => {
      try {
        window.localStorage.setItem(storageKey, serializeHybridAshedLayoutPrefs(next));
        window.dispatchEvent(new Event("storage"));
      } catch {
        // ignore
      }
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
      write({
        ...prefs,
        desktop: { ...prefs.desktop, hqRatio },
      });
    },
    [prefs, write],
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
