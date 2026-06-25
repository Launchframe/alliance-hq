"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  availablePlacements,
  clampPlacement,
  deviceClassForWidth,
  parsePreviewPrefs,
  serializePreviewPrefs,
  DEFAULT_PREVIEW_PREFS,
  PREVIEW_PREFS_STORAGE_KEY,
  type PreviewDeviceClass,
  type PreviewPlacement,
  type PreviewPrefs,
  type PreviewZoom,
} from "@/lib/video/preview-layout";

export type VideoPreviewLayout = {
  device: PreviewDeviceClass;
  /** Placement resolved (clamped) for the current device class. */
  placement: PreviewPlacement;
  available: PreviewPlacement[];
  open: boolean;
  zoom: PreviewZoom;
  setOpen: (next: boolean | ((open: boolean) => boolean)) => void;
  setPlacement: (placement: PreviewPlacement) => void;
  setZoom: (next: PreviewZoom | ((zoom: PreviewZoom) => PreviewZoom)) => void;
};

// --- Viewport (device class) external store -------------------------------

function subscribeViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

function getDeviceSnapshot(): PreviewDeviceClass {
  return deviceClassForWidth(window.innerWidth);
}

function getDeviceServerSnapshot(): PreviewDeviceClass {
  return "desktop";
}

// --- Preferences external store (localStorage-backed) ---------------------

let prefsCache: PreviewPrefs | null = null;
const prefsListeners = new Set<() => void>();

function readPrefs(): PreviewPrefs {
  if (prefsCache) return prefsCache;
  prefsCache = parsePreviewPrefs(
    window.localStorage.getItem(PREVIEW_PREFS_STORAGE_KEY),
  );
  return prefsCache;
}

function writePrefs(next: PreviewPrefs): void {
  prefsCache = next;
  try {
    window.localStorage.setItem(
      PREVIEW_PREFS_STORAGE_KEY,
      serializePreviewPrefs(next),
    );
  } catch {
    // ignore quota / privacy-mode write failures
  }
  for (const listener of prefsListeners) listener();
}

function subscribePrefs(onChange: () => void): () => void {
  prefsListeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREVIEW_PREFS_STORAGE_KEY) {
      prefsCache = parsePreviewPrefs(event.newValue);
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    prefsListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPrefsSnapshot(): PreviewPrefs {
  return readPrefs();
}

function getPrefsServerSnapshot(): PreviewPrefs {
  return DEFAULT_PREVIEW_PREFS;
}

/**
 * Resolve and persist the review video-preview layout. Device class is derived
 * from the viewport (updates on resize/rotate); placement is stored per device
 * class in localStorage so each form factor keeps its own preference.
 */
export function useVideoPreviewLayout(): VideoPreviewLayout {
  const device = useSyncExternalStore(
    subscribeViewport,
    getDeviceSnapshot,
    getDeviceServerSnapshot,
  );
  const prefs = useSyncExternalStore(
    subscribePrefs,
    getPrefsSnapshot,
    getPrefsServerSnapshot,
  );

  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) => {
      const current = readPrefs();
      const open = typeof next === "function" ? next(current.open) : next;
      writePrefs({ ...current, open });
    },
    [],
  );

  const setPlacement = useCallback(
    (placement: PreviewPlacement) => {
      const current = readPrefs();
      writePrefs({
        ...current,
        placement: { ...current.placement, [device]: placement },
      });
    },
    [device],
  );

  const setZoom = useCallback(
    (next: PreviewZoom | ((zoom: PreviewZoom) => PreviewZoom)) => {
      const current = readPrefs();
      const zoom = typeof next === "function" ? next(current.zoom) : next;
      writePrefs({ ...current, zoom });
    },
    [],
  );

  return {
    device,
    placement: clampPlacement(device, prefs.placement[device]),
    available: availablePlacements(device),
    open: prefs.open,
    zoom: prefs.zoom,
    setOpen,
    setPlacement,
    setZoom,
  };
}
